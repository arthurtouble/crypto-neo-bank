import type { DatabaseSync } from "node:sqlite";
import type { PrivyClient } from "@privy-io/node";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listOperations, readMarketAccount } from "@/lib/markets/accounts";
import { buildPerpsDeposit } from "@/lib/markets/deposits";
import { crossLiquidationPrice } from "@/lib/markets/hyperliquid/orders";
import {
  cancelPerpsOrder, completePerpsSignature, perpBook, perpCandles, placePerpsOrder, placePerpsTrade, previewPerpsTrade, relayPerpsActions, setPerpsLeverage, startPerpsSetup,
  startPerpsWithdrawal
} from "@/lib/markets/perps";
import type { DeviceSignRequest } from "@/lib/markets/signing";
import type { TypedData } from "@/lib/markets/types";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const now = new Date("2026-10-03T12:00:00.000Z");
const owner = "0x1111111111111111111111111111111111111111" as const;
// The trading key the customer's browser made; Aura's server never has it.
const device = privateKeyToAccount(`0x${"42".repeat(32)}`);
const agent = device.address.toLowerCase();
const stranger = privateKeyToAccount(`0x${"43".repeat(32)}`);
const later = now.getTime() + 86_400_000;
const account = { address: owner, walletId: "owner-wallet" };
const signature = `0x${"ab".repeat(64)}1b`;
let sqlite: DatabaseSync;
let db: D1Database;
let exchange: Array<Record<string, unknown>>;
let exchangeAnswer: unknown;
let agents: Array<{ name: string; address: string; validUntil: number }>;

const meta = [{ universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "ETH", szDecimals: 4, maxLeverage: 25 }] },
  [{ markPx: "60000", midPx: "60000", oraclePx: "60000", prevDayPx: "59000", dayNtlVlm: "1", funding: "0.0001", openInterest: "1" },
    { markPx: "3000", midPx: "3000", oraclePx: "3000", prevDayPx: "2900", dayNtlVlm: "1", funding: "0.0001", openInterest: "1" }]];
const state = { marginSummary: { accountValue: "100", totalMarginUsed: "0" }, crossMarginSummary: { accountValue: "100" },
  crossMaintenanceMarginUsed: "0", withdrawable: "50.5", time: 1, assetPositions: [] };

const fetcher = vi.fn(async (url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  if (url.endsWith("/exchange")) { exchange.push(body); return Response.json(exchangeAnswer); }
  if (body.type === "extraAgents") return Response.json(agents);
  if (body.type === "metaAndAssetCtxs") return Response.json(meta);
  if (body.type === "allPerpMetas") return Response.json([{ ...meta[0], collateralToken: 0 }]);
  if (body.type === "clearinghouseState") return Response.json(state);
  if (body.type === "userFees") return Response.json({ userCrossRate: "0.00045", userAddRate: "0.00015", activeReferralDiscount: "0.04" });
  if (body.type === "candleSnapshot") return Response.json([{ t: 1, T: 2, s: "BTC", i: "15m", o: "59900", c: "60000", h: "60100", l: "59800", v: "12.5", n: 40 }]);
  if (body.type === "l2Book") return Response.json({ coin: "BTC", time: 5, levels: [[{ px: "59999", sz: "1.2", n: 3 }, { px: "59998", sz: "2", n: 1 }], [{ px: "60001", sz: "0.5", n: 2 }]] });
  return new Response("unknown", { status: 400 });
}) as unknown as typeof fetch;

const signTypedData = vi.fn(async () => ({ signature }));
const create = vi.fn(async () => ({ id: "server-wallet", address: agent }));
const privy = {
  wallets: () => ({ create, rpc: vi.fn(async () => ({ data: { signature } })), ethereum: () => ({ signTypedData }) })
} as unknown as PrivyClient;

const sign = (key: typeof device, typedData: TypedData) => key.signTypedData(typedData as Parameters<typeof key.signTypedData>[0]);
/** What the browser does with a request Aura built: sign each action with its own key and relay them. */
async function relay(request: DeviceSignRequest, key = device) {
  return relayPerpsActions(db, "alice", owner, request.requestId, await Promise.all(request.typedData.map((item) => sign(key, item))), deps);
}
const deps = { privy, fetcher, now: () => now };

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');`);
  db = d1(sqlite);
  exchange = [];
  exchangeAnswer = { status: "ok", response: { type: "default" } };
  agents = [];
  vi.stubEnv("PRIVY_APP_SECRET", "test-secret");
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); signTypedData.mockClear(); create.mockClear(); });

describe("connecting a device to Hyperliquid", () => {
  it("has the owner approve the device's own trading key, then marks the connection ready", async () => {
    const started = await startPerpsSetup(db, "alice", account, agent, deps);
    if (started.status !== "sign") throw new Error("expected a signature request");
    expect(started.request.body.params.typed_data).toMatchObject({ primary_type: "HyperliquidTransaction:ApproveAgent",
      message: { agentAddress: agent, agentName: "Aura 1", nonce: now.getTime() } });
    expect(await readMarketAccount(db, "alice", "hyperliquid", owner)).toMatchObject({ status: "pending", tradingWalletId: null, tradingWalletAddress: agent });
    const done = await completePerpsSignature(db, "alice", account, started.requestId, "auth", deps);
    expect(done).toMatchObject({ status: "accepted", kind: "setup", next: { status: "sign", owner } });
    expect(exchange[0]).toMatchObject({ action: { type: "approveAgent", agentAddress: agent }, nonce: now.getTime() });
    expect(await readMarketAccount(db, "alice", "hyperliquid", owner)).toMatchObject({ status: "ready" });
    // Then the device's key puts the account in standard mode, one balance per dex.
    await relay(done.next!);
    expect(exchange[1]).toMatchObject({ action: { type: "agentSetAbstraction", abstraction: "i" } });
    // Once Hyperliquid lists the key, the device is ready without another passkey.
    agents = [{ name: "Aura 1", address: agent, validUntil: later }];
    expect(await startPerpsSetup(db, "alice", account, agent, deps)).toEqual({ status: "ready" });
    // Aura's server made no key and signed nothing.
    expect(create).not.toHaveBeenCalled();
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("gives each device its own slot, replaces Aura's oldest when all 3 are taken, and never another app's", async () => {
    const name = async (key: string) => {
      const started = await startPerpsSetup(db, "alice", account, key, deps);
      if (started.status !== "sign") throw new Error("expected a signature request");
      return (started.request.body.params.typed_data.message as { agentName: string }).agentName;
    };
    agents = [{ name: "Aura 1", address: stranger.address, validUntil: later }];
    expect(await name(agent)).toBe("Aura 2");
    agents = [{ name: "Aura 2", address: stranger.address, validUntil: later + 5 }, { name: "Aura 1", address: stranger.address, validUntil: later },
      { name: "Other app", address: stranger.address, validUntil: later - 5 }];
    expect(await name(agent)).toBe("Aura 1");
    agents = ["One", "Two", "Three"].map((item) => ({ name: item, address: stranger.address, validUntil: later }));
    await expect(name(agent)).rejects.toMatchObject({ code: "perps_keys_full" });
    await expect(startPerpsSetup(db, "alice", account, owner, deps)).rejects.toMatchObject({ code: "invalid_agent" });
  });

  it("retires a key Aura's server used to hold by approving the device's key under its name", async () => {
    const legacy = "0x9999999999999999999999999999999999999999";
    sqlite.exec(`INSERT INTO market_accounts (subject_reference, venue, owner_address, trading_wallet_id, trading_wallet_address, status, created_at, updated_at,
      approved_at) VALUES ('alice', 'hyperliquid', '${owner}', 'server-wallet', '${legacy}', 'ready', 't', 't', 't')`);
    agents = [{ name: "Aura", address: legacy, validUntil: later }];
    const started = await startPerpsSetup(db, "alice", account, agent, deps);
    if (started.status !== "sign") throw new Error("expected a signature request");
    expect(started.request.body.params.typed_data.message).toMatchObject({ agentAddress: agent, agentName: "Aura" });
    await completePerpsSignature(db, "alice", account, started.requestId, "auth", deps);
    expect(await readMarketAccount(db, "alice", "hyperliquid", owner)).toMatchObject({ status: "ready", tradingWalletId: null, tradingWalletAddress: agent });
  });

  it("keeps the connection pending and records Hyperliquid's refusal", async () => {
    const started = await startPerpsSetup(db, "alice", account, agent, deps);
    if (started.status !== "sign") throw new Error("expected a signature request");
    exchangeAnswer = { status: "err", response: `Must deposit before performing actions. User: ${owner}` };
    await expect(completePerpsSignature(db, "alice", account, started.requestId, "auth", deps)).rejects.toMatchObject({ code: "account_not_funded" });
    expect(await readMarketAccount(db, "alice", "hyperliquid", owner)).toMatchObject({ status: "pending" });
    expect((await listOperations(db, "alice", "hyperliquid"))[0]).toMatchObject({ kind: "setup", status: "rejected", reason: "account_not_funded" });
  });
});

async function connect() {
  const started = await startPerpsSetup(db, "alice", account, agent, deps);
  if (started.status === "sign") await completePerpsSignature(db, "alice", account, started.requestId, "auth", deps);
  exchange = [];
}

describe("trading with the device's trading key", () => {

  it("refuses before the wallet approved the key", async () => {
    await expect(placePerpsOrder(db, "alice", owner, { coin: "BTC", side: "buy", size: "0.001", type: "market" }, deps))
      .rejects.toMatchObject({ code: "perps_not_connected" });
  });

  it("builds orders, cancels, and leverage for the device to sign, relays them, and keeps Hyperliquid's answer", async () => {
    await connect();
    exchangeAnswer = { status: "ok", response: { type: "order", data: { statuses: [{ filled: { oid: 77, totalSz: "0.001", avgPx: "60010" } }] } } };
    const built = await placePerpsOrder(db, "alice", owner, { coin: "BTC", side: "buy", size: "0.001", type: "market" }, deps);
    expect(built).toMatchObject({ status: "sign", owner, typedData: [{ primaryType: "Agent" }] });
    // Nothing reaches Hyperliquid until the device signs.
    expect(exchange).toEqual([]);
    const placed = await relay(built);
    expect(placed.statuses).toEqual([{ kind: "filled", oid: 77, totalSz: "0.001", avgPx: "60010" }]);
    expect(exchange[0]).toMatchObject({ action: { type: "order", orders: [{ a: 0, b: true, s: "0.001", r: false, t: { limit: { tif: "Ioc" } } }] } });
    exchangeAnswer = { status: "ok", response: { type: "cancel", data: { statuses: ["success"] } } };
    await relay(await cancelPerpsOrder(db, "alice", owner, "ETH", 5, deps));
    expect(exchange[1]).toMatchObject({ action: { type: "cancel", cancels: [{ a: 1, o: 5 }] } });
    exchangeAnswer = { status: "ok", response: { type: "default" } };
    await relay(await setPerpsLeverage(db, "alice", owner, "BTC", true, 40, deps));
    await expect(setPerpsLeverage(db, "alice", owner, "BTC", true, 41, deps)).rejects.toThrow(/between 1 and 40/);
    expect((await listOperations(db, "alice", "hyperliquid")).map((item) => [item.kind, item.status, item.externalId]))
      .toEqual(expect.arrayContaining([["order", "accepted", "77"], ["cancel", "accepted", null], ["leverage", "accepted", null]]));
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("relays a request once, only as Aura built it, and asks the device to connect again when Hyperliquid doesn't know its key", async () => {
    await connect();
    const built = await setPerpsLeverage(db, "alice", owner, "BTC", true, 10, deps);
    const signatures = [await sign(device, built.typedData[0])];
    // A signature over anything else recovers to another key, which Hyperliquid refuses; two keys in one request are refused here.
    const two = await placePerpsTrade(db, "alice", owner, { coin: "BTC", side: "long", marginUsd: "20", leverage: 2, isCross: true, type: "market" }, deps);
    await expect(relayPerpsActions(db, "alice", owner, two.requestId, [await sign(device, two.typedData[0]), await sign(stranger, two.typedData[1])], deps))
      .rejects.toMatchObject({ code: "invalid_signature" });
    await expect(relayPerpsActions(db, "alice", owner, built.requestId, [], deps)).rejects.toMatchObject({ code: "invalid_signature" });
    exchangeAnswer = { status: "err", response: `User or API Wallet ${agent} does not exist.` };
    const fresh = await setPerpsLeverage(db, "alice", owner, "BTC", true, 10, deps);
    await expect(relay(fresh)).rejects.toMatchObject({ code: "perps_not_connected" });
    // Each request is used once.
    await expect(relayPerpsActions(db, "alice", owner, built.requestId, signatures, deps)).rejects.toMatchObject({ code: "signature_expired" });
    await expect(relay(fresh)).rejects.toMatchObject({ code: "signature_expired" });
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
  it("prices a cross position's liquidation on the money in the account, adding only what has to come in first", async () => {
    const cross = { coin: "BTC", side: "long" as const, leverage: 10, isCross: true, type: "market" as const };
    // $100 in the account and none in use: a $40 position's margin is already there, so the account stays at $100.
    const inside = await previewPerpsTrade(owner, { ...cross, marginUsd: "40" }, deps);
    expect(inside.liquidationPrice).toBe(crossLiquidationPrice({ side: "long", size: inside.size, price: "60000", maxLeverage: 40,
      accountValue: "100", maintenanceMarginUsed: "0" }));
    // A $150 position needs $50 more, which a one-tap deposit adds before the order.
    const over = await previewPerpsTrade(owner, { ...cross, marginUsd: "150" }, deps);
    expect(over.liquidationPrice).toBe(crossLiquidationPrice({ side: "long", size: over.size, price: "60000", maxLeverage: 40,
      accountValue: String(100 + Number(over.margin) - 100), maintenanceMarginUsed: "0" }));
  });

  it("sizes from margin × leverage, sets leverage first, then orders with auto-close attached", async () => {
    await connect();
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
    const built = await placePerpsTrade(db, "alice", owner, input, deps);
    expect(built.typedData).toHaveLength(2);
    const placed = await relay(built);
    expect(placed).toMatchObject({ size: "0.01666", margin: preview.margin, statuses: [{ kind: "filled", oid: 9 }, { kind: "waiting", for: "trigger" }] });
    expect(exchange.map((item) => (item.action as { type: string }).type)).toEqual(["updateLeverage", "order"]);
    expect(exchange[0]).toMatchObject({ action: { asset: 0, isCross: false, leverage: 10 } });
    expect(exchange[1]).toMatchObject({ action: { grouping: "normalTpsl", orders: [{ b: true, s: "0.01666" }, { b: false, r: true }] } });
    expect(exchange[1].nonce).toBeGreaterThan(exchange[0].nonce as number);
  });
});

describe("adding money through Circle, when Relay can't quote", () => {
  it("burns Base USDC for the owner's perps balance, with Circle's fee out of the amount", async () => {
    const fee = vi.fn(async () => ({ protocolFeeRaw: "3250", forwardFeeRaw: "247000", maxFeeRaw: "265217", minimumCreditRaw: "24734783" }));
    const noRelay = async () => { throw new Error("Relay is down"); };
    const built = await buildPerpsDeposit(owner, "25", { fee, balance: async () => undefined, relay: noRelay });
    expect(built).toMatchObject({ kind: "route", chainId: 8453, destinationChainId: 1337, countsTowardLimit: false,
      effects: [{ type: "erc20_debit", amountRaw: "25000000" }, { type: "delivery", tool: "cctp", to: owner, minimumRaw: "24734783" }],
      summary: { market: "hyperliquid", tool: "cctp" } });
    expect(built.calls.map((call) => call.to)).toEqual(["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d"]);
    await expect(buildPerpsDeposit(owner, "5", { fee, balance: async () => undefined, relay: noRelay })).rejects.toMatchObject({ code: "amount_too_small" });
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
    await perpBook("BTC", { ...deps, grouping: { sigFigs: 5, mantissa: 5 } });
    const last = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.map(([, init]) => JSON.parse(String(init.body))).findLast((body) => body.type === "l2Book");
    expect(last).toEqual({ type: "l2Book", coin: "BTC", nSigFigs: 5, mantissa: 5 });
    await expect(perpBook("NOPE", deps)).rejects.toMatchObject({ code: "market_not_found" });
  });
});
