import type { DatabaseSync } from "node:sqlite";
import type { PrivyClient } from "@privy-io/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listOperations, readMarketAccount } from "@/lib/markets/accounts";
import { buildPerpsDeposit } from "@/lib/markets/deposits";
import { cancelPerpsOrder, completePerpsSignature, perpBook, perpCandles, placePerpsOrder, placePerpsTrade, previewPerpsTrade, setPerpsLeverage, startPerpsSetup, startPerpsWithdrawal } from "@/lib/markets/perps";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const now = new Date("2026-10-03T12:00:00.000Z");
const owner = "0x1111111111111111111111111111111111111111" as const;
const agent = "0x9999999999999999999999999999999999999999";
const account = { address: owner, walletId: "owner-wallet" };
const signature = `0x${"ab".repeat(64)}1b`;
let sqlite: DatabaseSync;
let db: D1Database;
let exchange: Array<Record<string, unknown>>;
let exchangeAnswer: unknown;

const meta = [{ universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "ETH", szDecimals: 4, maxLeverage: 25 }] },
  [{ markPx: "60000", midPx: "60000", oraclePx: "60000", prevDayPx: "59000", dayNtlVlm: "1", funding: "0.0001", openInterest: "1" },
    { markPx: "3000", midPx: "3000", oraclePx: "3000", prevDayPx: "2900", dayNtlVlm: "1", funding: "0.0001", openInterest: "1" }]];
const state = { marginSummary: { accountValue: "100", totalMarginUsed: "0" }, crossMarginSummary: { accountValue: "100" },
  crossMaintenanceMarginUsed: "0", withdrawable: "50.5", time: 1, assetPositions: [] };

const fetcher = vi.fn(async (url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  if (url.endsWith("/exchange")) { exchange.push(body); return Response.json(exchangeAnswer); }
  if (body.type === "metaAndAssetCtxs") return Response.json(meta);
  if (body.type === "allPerpMetas") return Response.json([{ ...meta[0], collateralToken: 0 }]);
  if (body.type === "clearinghouseState") return Response.json(state);
  if (body.type === "userFees") return Response.json({ userCrossRate: "0.00045", userAddRate: "0.00015", activeReferralDiscount: "0.04" });
  if (body.type === "candleSnapshot") return Response.json([{ t: 1, T: 2, s: "BTC", i: "15m", o: "59900", c: "60000", h: "60100", l: "59800", v: "12.5", n: 40 }]);
  if (body.type === "l2Book") return Response.json({ coin: "BTC", time: 5, levels: [[{ px: "59999", sz: "1.2", n: 3 }, { px: "59998", sz: "2", n: 1 }], [{ px: "60001", sz: "0.5", n: 2 }]] });
  return new Response("unknown", { status: 400 });
}) as unknown as typeof fetch;

const signTypedData = vi.fn(async () => ({ signature }));
const privy = {
  wallets: () => ({
    create: vi.fn(async () => ({ id: "trading-wallet", address: agent })),
    rpc: vi.fn(async () => ({ data: { signature } })),
    ethereum: () => ({ signTypedData })
  })
} as unknown as PrivyClient;
const deps = { privy, fetcher, now: () => now };

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');`);
  db = d1(sqlite);
  exchange = [];
  exchangeAnswer = { status: "ok", response: { type: "default" } };
  vi.stubEnv("PRIVY_APP_SECRET", "test-secret");
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); signTypedData.mockClear(); });

describe("connecting a wallet to Hyperliquid", () => {
  it("has the owner approve Aura's trading key, then marks the connection ready", async () => {
    const started = await startPerpsSetup(db, "alice", account, deps);
    if (started.status !== "sign") throw new Error("expected a signature request");
    expect(started.request.body.params.typed_data).toMatchObject({ primary_type: "HyperliquidTransaction:ApproveAgent",
      message: { agentAddress: agent, agentName: "Aura", nonce: now.getTime() } });
    expect(await readMarketAccount(db, "alice", "hyperliquid", owner)).toMatchObject({ status: "pending", tradingWalletAddress: agent });
    // Asking again reuses the waiting key rather than making another.
    await startPerpsSetup(db, "alice", account, deps);
    expect(await completePerpsSignature(db, "alice", account, started.requestId, "auth", deps)).toEqual({ status: "accepted", kind: "setup" });
    expect(exchange[0]).toMatchObject({ action: { type: "approveAgent", agentAddress: agent }, nonce: now.getTime() });
    expect(await readMarketAccount(db, "alice", "hyperliquid", owner)).toMatchObject({ status: "ready" });
    expect(await startPerpsSetup(db, "alice", account, deps)).toEqual({ status: "ready" });
    // Then the trading key puts the account in standard mode, one balance per dex.
    expect(exchange[1]).toMatchObject({ action: { type: "agentSetAbstraction", abstraction: "i" } });
  });

  it("keeps the connection pending and records Hyperliquid's refusal", async () => {
    const started = await startPerpsSetup(db, "alice", account, deps);
    if (started.status !== "sign") throw new Error("expected a signature request");
    exchangeAnswer = { status: "err", response: `Must deposit before performing actions. User: ${owner}` };
    await expect(completePerpsSignature(db, "alice", account, started.requestId, "auth", deps)).rejects.toMatchObject({ code: "account_not_funded" });
    expect(await readMarketAccount(db, "alice", "hyperliquid", owner)).toMatchObject({ status: "pending" });
    expect((await listOperations(db, "alice", "hyperliquid"))[0]).toMatchObject({ kind: "setup", status: "rejected", reason: "account_not_funded" });
  });
});

describe("trading with the trading key", () => {
  async function connect() {
    const started = await startPerpsSetup(db, "alice", account, deps);
    if (started.status === "sign") await completePerpsSignature(db, "alice", account, started.requestId, "auth", deps);
    exchange = [];
  }

  it("refuses before the wallet approved the key", async () => {
    await expect(placePerpsOrder(db, "alice", owner, { coin: "BTC", side: "buy", size: "0.001", type: "market" }, deps))
      .rejects.toMatchObject({ code: "perps_not_connected" });
  });

  it("signs orders, cancels, and leverage with the trading key and keeps Hyperliquid's answer", async () => {
    await connect();
    exchangeAnswer = { status: "ok", response: { type: "order", data: { statuses: [{ filled: { oid: 77, totalSz: "0.001", avgPx: "60010" } }] } } };
    const placed = await placePerpsOrder(db, "alice", owner, { coin: "BTC", side: "buy", size: "0.001", type: "market" }, deps);
    expect(placed.statuses).toEqual([{ kind: "filled", oid: 77, totalSz: "0.001", avgPx: "60010" }]);
    expect(signTypedData).toHaveBeenCalledWith("trading-wallet", expect.objectContaining({ params: { typed_data: expect.objectContaining({ primary_type: "Agent" }) } }));
    expect(exchange[0]).toMatchObject({ action: { type: "order", orders: [{ a: 0, b: true, s: "0.001", r: false, t: { limit: { tif: "Ioc" } } }] } });
    exchangeAnswer = { status: "ok", response: { type: "cancel", data: { statuses: ["success"] } } };
    await cancelPerpsOrder(db, "alice", owner, "ETH", 5, deps);
    expect(exchange[1]).toMatchObject({ action: { type: "cancel", cancels: [{ a: 1, o: 5 }] } });
    exchangeAnswer = { status: "ok", response: { type: "default" } };
    await setPerpsLeverage(db, "alice", owner, "BTC", true, 40, deps);
    await expect(setPerpsLeverage(db, "alice", owner, "BTC", true, 41, deps)).rejects.toThrow(/between 1 and 40/);
    expect((await listOperations(db, "alice", "hyperliquid")).map((item) => [item.kind, item.status, item.externalId]))
      .toEqual(expect.arrayContaining([["order", "accepted", "77"], ["cancel", "accepted", null], ["leverage", "accepted", null]]));
  });
});

describe("withdrawing to Base", () => {
  it("asks the owner to sign a CCTP withdrawal to its own address, within what Hyperliquid says is withdrawable", async () => {
    await expect(startPerpsWithdrawal(db, "alice", account, "50.6", deps)).rejects.toMatchObject({ code: "insufficient_withdrawable" });
    const started = await startPerpsWithdrawal(db, "alice", account, "50.5", deps);
    expect(started.request.body.params.typed_data).toMatchObject({ primary_type: "HyperliquidTransaction:SendToEvmWithData",
      message: { amount: "50.5", destinationRecipient: owner, destinationChainId: 6, data: "0x" } });
    expect(await completePerpsSignature(db, "alice", account, started.requestId, "auth", deps)).toEqual({ status: "accepted", kind: "withdraw" });
    expect(exchange[0]).toMatchObject({ action: { type: "sendToEvmWithData", amount: "50.5" } });
  });
});

describe("trading from a dollar amount", () => {
  it("sizes from margin × leverage, sets leverage first, then orders with auto-close attached", async () => {
    const started = await startPerpsSetup(db, "alice", account, deps);
    if (started.status === "sign") await completePerpsSignature(db, "alice", account, started.requestId, "auth", deps);
    exchange = [];
    const input = { coin: "BTC", side: "long" as const, marginUsd: "100", leverage: 10, isCross: false, type: "market" as const,
      stopLoss: { triggerPrice: "55000" } };
    const preview = await previewPerpsTrade(owner, input, deps);
    expect(preview).toMatchObject({ size: "0.01666", price: "60000" });
    expect(Number(preview.liquidationPrice)).toBeGreaterThan(54_000);
    expect(Number(preview.liquidationPrice)).toBeLessThan(60_000);
    // The account's own taker rate, less its referral discount, on the order's notional.
    expect(preview.feeRate).toBe("0.000432");
    expect(preview.fee).toBe((Number(preview.notional) * 0.000432).toFixed(4));
    exchangeAnswer = { status: "ok", response: { type: "order", data: { statuses: [{ filled: { oid: 9, totalSz: "0.01666", avgPx: "60000" } }, "waitingForTrigger"] } } };
    const placed = await placePerpsTrade(db, "alice", owner, input, deps);
    expect(placed.size).toBe("0.01666");
    expect(exchange.map((item) => (item.action as { type: string }).type)).toEqual(["updateLeverage", "order"]);
    expect(exchange[0]).toMatchObject({ action: { asset: 0, isCross: false, leverage: 10 } });
    expect(exchange[1]).toMatchObject({ action: { grouping: "normalTpsl", orders: [{ b: true, s: "0.01666" }, { b: false, r: true }] } });
    expect(exchange[1].nonce).toBeGreaterThan(exchange[0].nonce as number);
  });
});

describe("adding money through Circle", () => {
  it("burns Base USDC for the owner's perps balance, with Circle's fee out of the amount", async () => {
    const fee = vi.fn(async () => ({ protocolFeeRaw: "3250", forwardFeeRaw: "247000", maxFeeRaw: "265217", minimumCreditRaw: "24734783" }));
    const built = await buildPerpsDeposit(owner, "25", { fee, balance: async () => undefined });
    expect(built).toMatchObject({ kind: "route", chainId: 8453, destinationChainId: 1337, countsTowardLimit: false,
      effects: [{ type: "erc20_debit", amountRaw: "25000000" }, { type: "delivery", tool: "cctp", to: owner, minimumRaw: "24734783" }],
      summary: { market: "hyperliquid", tool: "cctp" } });
    expect(built.calls.map((call) => call.to)).toEqual(["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d"]);
    await expect(buildPerpsDeposit(owner, "5", { fee, balance: async () => undefined })).rejects.toMatchObject({ code: "amount_too_small" });
  });
});

describe("charts and the order book", () => {
  it("reads candles for a range and the book with its spread, for listed markets only", async () => {
    const chart = await perpCandles("BTC", "1d", deps);
    expect(chart).toMatchObject({ status: "observed", data: { coin: "BTC", interval: "15m", candles: [{ t: 1, o: "59900", c: "60000", v: "12.5" }] } });
    const request = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
      .map(([, init]) => JSON.parse(String(init.body)) as { type: string; req?: { startTime: number; endTime: number } }).findLast((body) => body.type === "candleSnapshot");
    expect(request?.req).toEqual({ coin: "BTC", interval: "15m", startTime: now.getTime() - 86_400_000, endTime: now.getTime() });
    const book = await perpBook("BTC", deps);
    expect(book).toMatchObject({ status: "observed", data: { bids: [{ price: "59999", size: "1.2", orders: 3 }, { price: "59998" }], asks: [{ price: "60001" }], spread: "2" } });
    await expect(perpBook("NOPE", deps)).rejects.toMatchObject({ code: "market_not_found" });
  });
});
