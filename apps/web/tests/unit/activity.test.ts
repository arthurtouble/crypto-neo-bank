import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const state = vi.hoisted(() => ({ db: null as D1Database | null, incoming: null as unknown, readWallets: [] as string[],
  cards: { status: "available", partial: false, items: [] } as import("@/lib/cards/service").CardHistory }));
const wallet = "0x1111111111111111111111111111111111111111";
const friend = "0x2222222222222222222222222222222222222222";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const xaut = "0x68749665ff8d2d112fa859aa293f07a622782f38";
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "s" }) }));
vi.mock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => wallet }));
vi.mock("@/lib/defi/aave", async (original) => ({ ...await original<object>(), getAaveBaseActivity: async () => ({ items: [], partial: false, sourceStatus: "none" }) }));
vi.mock("@/lib/activity/incoming", async (original) => {
  const actual = await original<typeof import("@/lib/activity/incoming")>();
  return { ...actual, readIncoming: async (address: string, options: Parameters<typeof actual.readIncoming>[1]) => {
    state.readWallets.push(address);
    const read = state.incoming as Awaited<ReturnType<typeof actual.readIncoming>>;
    const exclude = new Set(options?.exclude ?? []);
    return { ...read, transfers: read.transfers.filter((transfer) => !exclude.has(transfer.transactionHash)
      && (!options?.since || Date.parse(transfer.receivedAt) >= options.since.getTime()) && (!options?.until || Date.parse(transfer.receivedAt) < options.until.getTime())) };
  } };
});

vi.mock("@/lib/cards/service", async (original) => ({ ...await original<object>(),
  readCardHistory: async (_db: unknown, _subject: string, window: { since?: Date; until?: Date } = {}) => ({ ...state.cards,
    items: state.cards.items.filter((item) => (!window.since || Date.parse(item.createdAt) >= window.since.getTime()) && (!window.until || Date.parse(item.createdAt) < window.until.getTime())) }) }));

const { parseTransfer, readIncoming } = await vi.importActual<typeof import("@/lib/activity/incoming")>("@/lib/activity/incoming");
const { actionEntry, cardEntry, entriesCsv, entryAmount, entryCategory, entryLabel, incomingEntry } = await import("@/lib/activity/entries");
const { labelMarketWithdrawals } = await import("@/lib/activity/markets");
const { buildInsights } = await import("@/lib/insights/presentation");
const { GET: activity } = await import("@/app/api/activity/route");
const { GET: statement } = await import("@/app/api/statements/route");
const { GET: insights } = await import("@/app/api/insights/route");

type Raw = Parameters<typeof parseTransfer>[0];
const erc20 = (token: string, value: bigint, overrides: Partial<Raw> = {}): Raw => ({ blockNum: "0x64", uniqueId: `${hash(1)}:log:0`, hash: hash(1), from: friend, to: wallet,
  category: "erc20", rawContract: { value: `0x${value.toString(16)}`, address: token }, metadata: { blockTimestamp: "2026-09-10T12:00:00.000Z" }, ...overrides });
type CardItem = import("@/lib/cards/service").CardActivity;
const card = (overrides: Partial<CardItem> = {}): CardItem => ({ id: "ipi_1", kind: "payment", status: "completed", amountUsd: "12.50", merchant: "Corner Cafe",
  createdAt: "2026-09-12T09:00:00.000Z", transactionId: "ipi_1", disputable: true, dispute: null, transactionHash: hash(30), authorizationId: "iauth_1", ...overrides });
const transfer = (n: number, receivedAt: string, amountRaw = "5000000") => parseTransfer(erc20(usdc, BigInt(amountRaw), { hash: hash(n), uniqueId: `${hash(n)}:log:0`,
  metadata: { blockTimestamp: receivedAt } }), 8453, wallet, 1000n)!;

describe("reading money that arrived without an action", () => {
  it("lists registered assets the account holds, from someone else, complete once final", () => {
    expect(parseTransfer(erc20(usdc, 5_000_000n), 8453, wallet, 100n)).toMatchObject({ assetId: `8453:${usdc}`, symbol: "USDC", amount: "5",
      from: "0x2222222222222222222222222222222222222222", status: "completed", final: true, source: "Alchemy, Base", receivedAt: "2026-09-10T12:00:00.000Z" });
    // Complete once in a block, like mainstream wallets; final once the block is.
    expect(parseTransfer(erc20(usdc, 5_000_000n), 8453, wallet, 99n)).toMatchObject({ status: "completed", final: false });
    // Tether Gold is held on Ethereum.
    expect(parseTransfer(erc20(xaut, 1_000_000n), 1, wallet, 100n)).toMatchObject({ symbol: "XAUt", amount: "1" });
  });

  it("ignores spam tokens, assets the account doesn't hold there, zero amounts, and its own transfers", () => {
    expect(parseTransfer(erc20("0x9999999999999999999999999999999999999999", 1n), 8453, wallet, 100n)).toBeNull();
    expect(parseTransfer(erc20(usdc, 5n), 1, wallet, 100n)).toBeNull();
    expect(parseTransfer({ ...erc20(usdc, 1n), category: "external", rawContract: { value: "0x1", address: null } }, 1, wallet, 100n)).toBeNull();
    expect(parseTransfer(erc20(usdc, 0n), 8453, wallet, 100n)).toBeNull();
    expect(parseTransfer(erc20(usdc, 5n, { from: wallet }), 8453, wallet, 100n)).toBeNull();
    expect(parseTransfer(erc20(usdc, 5n, { to: friend }), 8453, wallet, 100n)).toBeNull();
    expect(parseTransfer({ ...erc20(usdc, 10n ** 18n), category: "external", rawContract: { value: "0xde0b6b3a7640000", address: null } }, 8453, wallet, 100n))
      .toMatchObject({ symbol: "ETH", amount: "1" });
  });

  describe("from Alchemy", () => {
    beforeEach(() => { vi.stubEnv("RPC_URL_8453", "https://base-mainnet.g.alchemy.com/v2/test"); vi.stubEnv("RPC_URL_1", "https://eth-mainnet.g.alchemy.com/v2/test"); });
    afterEach(() => vi.unstubAllEnvs());
    const node = (transfers: Record<string, Raw[] | "down">, pageKey?: string) => vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      const chain = String(url).includes("base") ? "base" : "eth";
      if (transfers[chain] === "down") return new Response("down", { status: 503 });
      if (method === "eth_getBlockByNumber") return Response.json({ result: { number: "0x64" } });
      return Response.json({ result: { transfers: transfers[chain] ?? [], ...(pageKey ? { pageKey } : {}) } });
    }) as unknown as typeof fetch;

    it("leaves out transfers made by the account's own actions, and reads both networks", async () => {
      const own = erc20(usdc, 7n, { hash: hash(2), uniqueId: `${hash(2)}:log:0` });
      const read = await readIncoming(wallet, { fetcher: node({ base: [erc20(usdc, 5_000_000n), own], eth: [erc20(xaut, 1_000_000n, { hash: hash(3) })] }), exclude: [hash(2)] });
      expect(read).toMatchObject({ status: "available", partial: false });
      expect(read.transfers.map((item) => item.symbol).sort()).toEqual(["USDC", "XAUt"]);
    });

    it("says so when a network can't be read or there are older pages, instead of looking complete", async () => {
      const down = await readIncoming(wallet, { fetcher: node({ base: [erc20(usdc, 5_000_000n)], eth: "down" }) });
      expect(down).toMatchObject({ status: "unavailable" });
      expect(down.transfers).toHaveLength(1);
      expect(await readIncoming(wallet, { fetcher: node({ base: [erc20(usdc, 5_000_000n)] }, "next") })).toMatchObject({ partial: true });
    });

    it("reads an older page back through the index, up to a page from before the time asked", async () => {
      // Each page holds one newer and one older transfer; the older page keeps reading until it has 100 from before `until`.
      let calls = 0;
      const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const { method } = JSON.parse(String(init?.body)) as { method: string };
        if (method === "eth_getBlockByNumber") return Response.json({ result: { number: "0x64" } });
        if (!String(url).includes("base")) return Response.json({ result: { transfers: [] } });
        calls++;
        const transfers = Array.from({ length: 100 }, (_, index) => erc20(usdc, 5_000_000n, { hash: hash(1000 * calls + index), uniqueId: `${hash(1000 * calls + index)}:log:0`,
          metadata: { blockTimestamp: new Date(Date.parse("2026-09-30T00:00:00.000Z") - (calls * 100 + index) * 60_000).toISOString() } }));
        return Response.json({ result: { transfers, pageKey: "next" } });
      }) as unknown as typeof fetch;
      const until = new Date(Date.parse("2026-09-30T00:00:00.000Z") - 150 * 60_000);
      const read = await readIncoming(wallet, { fetcher, until });
      expect(read.transfers.every((transfer) => Date.parse(transfer.receivedAt) <= until.getTime())).toBe(true);
      expect(read.transfers.length).toBeGreaterThanOrEqual(100);
      // More pages remain, so the read says older transfers exist.
      expect(read).toMatchObject({ status: "available", partial: true });
      expect(calls).toBe(2);
    });

    it("is unavailable without a transfer index, never empty", async () => {
      vi.stubEnv("RPC_URL_1", "https://ethereum-rpc.publicnode.com");
      expect(await readIncoming(wallet, { fetcher: node({ base: [] }) })).toMatchObject({ status: "unavailable" });
    });
  });
});

const action = (overrides: Partial<Parameters<typeof actionEntry>[0]> = {}): Parameters<typeof actionEntry>[0] => ({ id: "a1", kind: "transfer", chainId: 8453, status: "confirmed",
  summary: { symbol: "USDC", amount: "10", to: friend }, usdCents: 1000, transactionHash: hash(9), destinationChainId: null, destinationTransactionHash: null,
  failureReason: null, createdAt: "2026-09-05T10:00:00.000Z", ...overrides });

describe("one entry per transaction", () => {
  it("describes sends, swaps, moves, and Earn the same way everywhere", () => {
    expect(actionEntry(action())).toMatchObject({ type: "sent", status: "completed", amount: "10", asset: "USDC", counterparty: friend, estimatedUsd: 10, source: "Aura" });
    const swap = actionEntry(action({ kind: "route", summary: { from: { symbol: "USDC", decimals: 6 }, to: { symbol: "AAPLc", decimals: 8 }, fromAmountRaw: "2000000",
      toAmountRaw: "585000", recipient: wallet, external: false } }));
    expect(swap).toMatchObject({ type: "swap", amount: "2", toAmount: "0.00585", toAsset: "AAPLc" });
    expect(swap.counterparty).toBeUndefined();
    expect(entryAmount(swap)).toBe("2 USDC for 0.00585 AAPLc");
    expect(actionEntry(action({ kind: "route", destinationChainId: 1, summary: { from: { symbol: "ETH", decimals: 18 }, to: { symbol: "ETH", decimals: 18 },
      fromAmountRaw: "10", toAmountRaw: "9", recipient: wallet, external: false } })).type).toBe("bridge");
    expect(actionEntry(action({ kind: "route", destinationChainId: 1, summary: { from: { symbol: "USDC", decimals: 6 }, fromAmountRaw: "1", recipient: friend, external: true } })))
      .toMatchObject({ type: "sent", counterparty: friend });
    // "Withdraw all" shows what the shares were worth, not the word "all".
    expect(actionEntry(action({ kind: "earn", summary: { protocol: "morpho", vaultName: "Steakhouse Prime USDC", direction: "withdraw", symbol: "USDC", decimals: 6, amount: "all", amountRaw: "1000000" } })))
      .toMatchObject({ type: "earn_withdraw", amount: "1", counterparty: "Steakhouse Prime USDC" });
    expect(actionEntry(action({ status: "expired" })).status).toBe("not_confirmed");
    expect(actionEntry(action({ status: "settling" }))).toMatchObject({ status: "completed", final: false });
    expect(actionEntry(action())).toMatchObject({ status: "completed", final: true });
    // A move to another network stays pending until it arrives.
    expect(actionEntry(action({ status: "settling", destinationChainId: 1 })).status).toBe("pending");
    expect(actionEntry(action({ summary: { symbol: "USDC", amount: "25", to: friend, bankPayout: { bankName: "Chase", lastFour: "4321" } } })).counterparty).toBe("Chase ending 4321");
    // Letting the card spend moves nothing, so it isn't money sent or counted as spending.
    const allowance = actionEntry(action({ summary: { symbol: "USDC", amount: "50", cardAllowance: { spender: friend } } }));
    expect(allowance).toMatchObject({ type: "card_allowance", counterparty: "Aura card", amount: "50" });
    expect(allowance.estimatedUsd).toBeUndefined();
    const off = actionEntry(action({ summary: { symbol: "USDC", amount: "0", cardAllowance: { spender: friend, off: true } } }));
    expect(off).toMatchObject({ type: "card_spending_off", counterparty: "Aura card" });
    expect([entryLabel(off.type), entryCategory(off.type)]).toEqual(["Card spending turned off", "Card"]);
  });

  it("says when money went to or came back from perps or predictions", () => {
    const perps = actionEntry(action({ kind: "route", destinationChainId: 1337, summary: { from: { symbol: "USDC", decimals: 6 }, to: { symbol: "USDC", decimals: 6 },
      fromAmountRaw: "8000000", toAmountRaw: "7980000", recipient: wallet, external: false, market: "hyperliquid" } }));
    expect(perps).toMatchObject({ type: "perps_deposit", amount: "8", asset: "USDC", counterparty: "Hyperliquid" });
    expect([entryLabel(perps.type), entryCategory(perps.type)]).toEqual(["Added to perps", "Markets"]);
    const predictions = actionEntry(action({ summary: { symbol: "USDC", amount: "5", to: friend, market: "polymarket" } }));
    expect(predictions).toMatchObject({ type: "predictions_deposit", amount: "5", counterparty: "Polymarket" });
    expect(entryLabel(predictions.type)).toBe("Added to predictions");

    const withdrawal = (venue: "hyperliquid" | "polymarket", amount: string, createdAt: string, destination = wallet) => ({ id: `${venue}-${amount}`, venue,
      kind: "withdraw" as const, summary: { amount, destination, network: "Base" }, externalId: null, status: "accepted" as const, reason: null, source: "t",
      createdAt, observedAt: createdAt });
    const arrivals = [incomingEntry(transfer(40, "2026-09-10T12:01:00.000Z", "49000000")), incomingEntry(transfer(41, "2026-09-10T12:02:00.000Z", "20000000")),
      incomingEntry(transfer(42, "2026-09-10T12:03:00.000Z", "19900000")), incomingEntry(transfer(43, "2026-09-12T12:03:00.000Z", "9900000"))];
    const labelled = labelMarketWithdrawals(arrivals, [withdrawal("hyperliquid", "50", "2026-09-10T12:00:00.000Z"),
      withdrawal("polymarket", "20", "2026-09-10T12:01:30.000Z"), withdrawal("polymarket", "10", "2026-09-10T12:00:00.000Z"),
      withdrawal("hyperliquid", "30", "2026-09-10T12:00:00.000Z", friend)], wallet);
    // $50 from perps arrives less Hyperliquid's $1 fee; the first $20 after the predictions withdrawal is it, the next is someone else's.
    expect(labelled.map((entry) => [entry.type, entry.counterparty])).toEqual([["perps_withdraw", "Hyperliquid"], ["predictions_withdraw", "Polymarket"],
      ["received", friend], ["received", friend]]);
    expect(labelled[0]).toMatchObject({ amount: "49", source: "Alchemy, Base · Hyperliquid", status: "completed" });
    expect(entryLabel(labelled[1]!.type)).toBe("Withdrawn from predictions");
  });

  it("values money received at today's price, when there is one", () => {
    expect(incomingEntry(transfer(4, "2026-09-10T12:00:00.000Z"), 100)).toMatchObject({ type: "received", origin: "incoming", estimatedUsd: 5, counterparty: friend });
    expect(incomingEntry(transfer(4, "2026-09-10T12:00:00.000Z"), null).estimatedUsd).toBeUndefined();
  });

  it("exports the same columns everywhere, and neutralizes spreadsheet formulas", () => {
    const csv = entriesCsv([actionEntry(action({ summary: { symbol: "USDC", amount: "10", to: "=HYPERLINK(1)" } }))], () => "Base").trim().split("\n");
    expect(csv[0]).toBe('"Date","Description","Status","Amount","Asset","Received amount","Received asset","Counterparty","Estimated USD","Network","Transaction","Final","Source"');
    expect(csv[1]).toContain('"Sent","Completed","10","USDC","","","\'=HYPERLINK(1)","10.00","Base","0x0000000000000000000000000000000000000000000000000000000000000009","Yes"');
  });
});

describe("card payments in Transactions", () => {
  it("shows payments, refunds, holds, and declines from Stripe, with the Base transaction that paid", () => {
    expect(cardEntry(card())).toMatchObject({ id: "card:ipi_1", origin: "card", type: "card_payment", status: "completed", final: true, amount: "12.50", asset: "USD",
      counterparty: "Corner Cafe", estimatedUsd: 12.5, transactionHash: hash(30), chainId: 8453, source: "Stripe" });
    expect(cardEntry(card({ kind: "refund" })).type).toBe("card_refund");
    expect(cardEntry(card({ id: "iauth_1", status: "pending", transactionHash: null }))).toMatchObject({ status: "pending", final: false, transactionHash: undefined });
    const declined = cardEntry(card({ id: "iauth_2", status: "declined" }));
    // A decline moved no money, so it has no value to count.
    expect(declined).toMatchObject({ status: "failed", failureReason: "Declined" });
    expect(declined.estimatedUsd).toBeUndefined();
    expect(cardEntry(card({ dispute: { id: "idp_1", status: "submitted" } })).cardDispute).toBe("submitted");
    expect([entryCategory("card_payment"), entryCategory("card_refund"), entryCategory("card_allowance")]).toEqual(["Card", "Card", "Card"]);
  });

  it("counts card payments as money out and refunds as money in", () => {
    const result = buildInsights([cardEntry(card()), cardEntry(card({ id: "ipi_2", kind: "refund", amountUsd: "2.50" })), cardEntry(card({ id: "iauth_3", status: "declined" }))],
      new Date("2026-09-20T00:00:00.000Z"), 30);
    expect(result.totals).toMatchObject({ outgoing: 12.5, incoming: 2.5, unvalued: 0 });
    expect(result.completedCount).toBe(2);
  });
});

describe("insights over time and by merchant", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  it("buckets money in and out by day for a week, by week (from Monday) up to 90 days, and by month for a year, in UTC", () => {
    const entries = [cardEntry(card({ createdAt: "2026-09-18T23:30:00.000Z" })), incomingEntry(transfer(6, "2026-09-19T00:10:00.000Z", "20000000"), 100),
      cardEntry(card({ id: "ipi_r", kind: "refund", amountUsd: "2.00", createdAt: "2026-09-19T08:00:00.000Z" }))];
    const week = buildInsights(entries, now, 7);
    expect(week.over.unit).toBe("day");
    expect(week.over.buckets).toHaveLength(8);
    expect(week.over.buckets.filter((bucket) => bucket.incoming || bucket.outgoing)).toEqual([
      { start: "2026-09-18T00:00:00.000Z", incoming: 0, outgoing: 12.5 }, { start: "2026-09-19T00:00:00.000Z", incoming: 22, outgoing: 0 }]);
    const month = buildInsights(entries, now, 30);
    expect(month.over.unit).toBe("week");
    // 20 September 2026 is a Sunday: its week began on Monday the 14th.
    expect(month.over.buckets.at(-1)).toEqual({ start: "2026-09-14T00:00:00.000Z", incoming: 22, outgoing: 12.5 });
    const year = buildInsights(entries, now, 365);
    expect(year.over.unit).toBe("month");
    expect(year.over.buckets).toHaveLength(13);
    expect(year.over.buckets.at(-1)).toEqual({ start: "2026-09-01T00:00:00.000Z", incoming: 22, outgoing: 12.5 });
  });

  it("ranks the card merchants paid most, leaving out declines and refunds", () => {
    const entries = [cardEntry(card()), cardEntry(card({ id: "ipi_2", amountUsd: "7.50" })), cardEntry(card({ id: "ipi_3", merchant: "Books", amountUsd: "30" })),
      cardEntry(card({ id: "iauth_d", merchant: "Shop", status: "declined" })), cardEntry(card({ id: "ipi_r", merchant: "Shop", kind: "refund" })),
      ...["A", "B", "C", "D"].map((merchant, index) => cardEntry(card({ id: `ipi_m${index}`, merchant, amountUsd: "1" })))];
    expect(buildInsights(entries, now, 30).topMerchants).toEqual([{ name: "Books", total: 30, payments: 1 }, { name: "Corner Cafe", total: 20, payments: 2 },
      { name: "A", total: 1, payments: 1 }, { name: "B", total: 1, payments: 1 }, { name: "C", total: 1, payments: 1 }]);
  });
});

describe("insights", () => {
  it("counts money in, money out, Earn deposits, and swaps from completed entries in the period", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    const result = buildInsights([
      actionEntry(action({ createdAt: "2026-09-20T12:00:00.000Z" })),
      incomingEntry(transfer(5, "2026-09-21T12:00:00.000Z", "80000000"), 100),
      actionEntry(action({ kind: "earn", createdAt: "2026-09-21T00:00:00.000Z", usdCents: 5000, summary: { direction: "deposit", symbol: "USDC", amount: "50" } })),
      // Taking money out of Earn is neither money in nor put to work.
      actionEntry(action({ kind: "earn", createdAt: "2026-09-21T00:00:00.000Z", usdCents: 2000, summary: { direction: "withdraw", symbol: "USDC", amount: "20" } })),
      actionEntry(action({ status: "submitted", createdAt: "2026-09-21T00:00:00.000Z" })),
      actionEntry(action({ usdCents: null, createdAt: "2026-09-21T00:00:00.000Z" })),
      actionEntry(action({ createdAt: "2026-07-01T00:00:00.000Z" }))
    ], now, 30);
    expect(result.totals).toEqual({ incoming: 80, outgoing: 10, allocation: 50, movement: 0, unvalued: 1 });
    expect(result.completedCount).toBe(5);
  });

  it("doesn't count borrowing as money in or repaying as money out", () => {
    const entry = (type: "borrow" | "repay") => ({ id: type, origin: "aave", type, status: "completed", createdAt: "2026-09-21T00:00:00.000Z", chainId: 8453,
      asset: "USDC", amount: "100", estimatedUsd: 100, source: "Aave" }) as import("@/lib/activity/entries").ActivityEntry;
    const result = buildInsights([entry("borrow"), entry("repay")], new Date("2026-09-22T12:00:00Z"), 30);
    expect(result.totals).toMatchObject({ incoming: 0, outgoing: 0 });
  });
});

describe("the Transactions API", () => {
  let sqlite: DatabaseSync;
  const insert = (id: string, created: string, status: string, tx: string | null) => sqlite.exec(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id,
    summary_json, calls_json, calls_fingerprint, effects_json, counts_toward_limit, usd_cents, status, transaction_hash, created_at, expires_at, updated_at)
    VALUES ('${id}', 'alice', '${wallet}', 'transfer', 8453, json_object('symbol', 'USDC', 'amount', '10', 'to', '${friend}'),
    '[{"to":"${usdc}","value":"0","data":"0x"}]', 'fp', '[]', 1, 1000, '${status}', ${tx ? `'${tx}'` : "NULL"}, '${created}', '${created}', '${created}');`);
  beforeEach(() => {
    sqlite = schemaDatabase();
    state.db = d1(sqlite);
    state.readWallets = [];
    sqlite.exec("INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');");
    insert("a", "2026-09-02T10:00:00.000Z", "confirmed", hash(10));
    insert("b", "2026-09-03T10:00:00.000Z", "expired", null);
    insert("c", "2026-10-01T00:00:00.000Z", "confirmed", hash(11));
    // The account's own action also shows up in the transfer index; it must not be listed twice.
    state.incoming = { status: "available", partial: false, observedAt: "t", transfers: [transfer(12, "2026-09-15T08:00:00.000Z"), transfer(10, "2026-09-02T10:00:00.000Z")] };
    state.cards = { status: "available", partial: false, items: [] };
  });
  afterEach(() => sqlite.close());

  it("lists the customer's own account only, whatever address is asked for", async () => {
    const body = await (await activity(new Request(`https://aura.test/api/activity?address=${friend}`))).json() as import("@/lib/activity/history").History;
    expect(state.readWallets).toEqual([wallet]);
    expect(body.entries.map((entry) => [entry.type, entry.status])).toEqual([["sent", "completed"], ["received", "completed"], ["sent", "not_confirmed"], ["sent", "completed"]]);
    expect(body.sources.incoming).toEqual({ status: "available", partial: false });
  });

  it("pages back through older activity without skipping any, and refuses a malformed time", async () => {
    // 120 more actions than one page reads: the first page stops at the oldest action it read, so the older
    // transfer and actions wait for the next page instead of leaving a gap.
    for (let index = 0; index < 120; index++) insert(`p${index}`, new Date(Date.parse("2026-09-20T00:00:00.000Z") + index * 60_000).toISOString(), "confirmed", hash(500 + index));
    const first = await (await activity(new Request("https://aura.test/api/activity"))).json() as import("@/lib/activity/history").History;
    expect(first.entries).toHaveLength(100);
    expect(first.more).toBe(true);
    expect(first.entries.some((entry) => entry.id === "a")).toBe(false);
    const oldest = first.entries.at(-1)!.createdAt;
    const second = await (await activity(new Request(`https://aura.test/api/activity?before=${encodeURIComponent(oldest)}`))).json() as import("@/lib/activity/history").History;
    const seen = new Set(first.entries.map((entry) => entry.id));
    const added = second.entries.filter((entry) => !seen.has(entry.id));
    // The 21 actions cut off, a, the expired b, and the received transfer, once each.
    expect(added.map((entry) => entry.id)).toEqual(expect.arrayContaining(["p20", "p0", "a", "b"]));
    expect(added.filter((entry) => entry.type === "received")).toHaveLength(1);
    expect(added).toHaveLength(24);
    expect(second.more).toBe(false);
    expect((await activity(new Request("https://aura.test/api/activity?before=yesterday"))).status).toBe(400);
  });

  it("gives a month's statement with money sent and received, oldest first", async () => {
    const response = await statement(new Request("https://aura.test/api/statements?month=2026-09"));
    expect(response.headers.get("content-disposition")).toContain("aura-statement-2026-09.csv");
    const lines = (await response.text()).trim().split("\n");
    // The expired action moved nothing, so a statement leaves it out.
    expect(lines.slice(1).map((line) => line.split(",")[1])).toEqual(['"Sent"', '"Received"']);
    expect(lines[2]).toContain('"5","USDC"');
  });

  it("refuses a statement it can't complete, and a malformed month", async () => {
    state.incoming = { status: "unavailable", partial: false, observedAt: "t", transfers: [] };
    const response = await statement(new Request("https://aura.test/api/statements?month=2026-09"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "statement_incomplete" });
    expect((await statement(new Request("https://aura.test/api/statements?month=2026-13"))).status).toBe(400);
  });

  it("shows money in as unknown in Insights when received money can't all be read", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-20T00:00:00.000Z"), toFake: ["Date"] });
    try {
      const complete = await (await insights(new Request("https://aura.test/api/insights?days=30"))).json() as { totals: { incoming: number; outgoing: number }; incomingComplete: boolean };
      expect(complete).toMatchObject({ incomingComplete: true, totals: { incoming: 5, outgoing: 10 } });
      state.incoming = { status: "available", partial: true, observedAt: "t", transfers: [] };
      expect(await (await insights(new Request("https://aura.test/api/insights?days=30"))).json()).toMatchObject({ incomingComplete: false });
    } finally { vi.useRealTimers(); }
  });

  it("says Insights can't be loaded, with a message for the customer, when the period can't be read", async () => {
    state.incoming = null;
    const response = await insights(new Request("https://aura.test/api/insights?days=30"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "insights_unavailable", message: "Insights can't be loaded right now." });
  });

  it("lists card payments with everything else, and says when Stripe can't be read", async () => {
    state.cards = { status: "available", partial: false, items: [card()] };
    const body = await (await activity(new Request("https://aura.test/api/activity"))).json() as import("@/lib/activity/history").History;
    expect(body.entries.map((entry) => entry.type)).toEqual(["sent", "received", "card_payment", "sent", "sent"]);
    expect(body.sources.card).toEqual({ status: "available", partial: false });
    const lines = (await (await statement(new Request("https://aura.test/api/statements?month=2026-09"))).text()).trim().split("\n");
    expect(lines.slice(1).map((line) => line.split(",")[1])).toEqual(['"Sent"', '"Card payment"', '"Received"']);
    expect(lines[2]).toContain('"12.50","USD","","","Corner Cafe","12.50","Base"');

    state.cards = { status: "unavailable", partial: false, items: [] };
    expect((await (await activity(new Request("https://aura.test/api/activity"))).json() as import("@/lib/activity/history").History).sources.card.status).toBe("unavailable");
    // A statement without every card payment would be short, so it's refused; Insights shows money out as unknown.
    expect(await (await statement(new Request("https://aura.test/api/statements?month=2026-09"))).json()).toMatchObject({ error: "statement_incomplete" });
    vi.useFakeTimers({ now: new Date("2026-09-20T00:00:00.000Z"), toFake: ["Date"] });
    try { expect(await (await insights(new Request("https://aura.test/api/insights?days=30"))).json()).toMatchObject({ outgoingComplete: false, incomingComplete: false }); }
    finally { vi.useRealTimers(); }
  });
});
