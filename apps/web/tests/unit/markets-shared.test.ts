import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storedActionGates, routeFeatures } from "@/lib/actions/prepare";
import type { StoredAction } from "@/lib/actions/store";
import { listOperations, markAccountReady, readMarketAccount, recordOperation, savePendingAccount } from "@/lib/markets/accounts";
import { openCredentials, sealCredentials } from "@/lib/markets/credentials";
import { observeHyperliquidCredit } from "@/lib/markets/funding";
import { completeMarketSignature, createMarketSignature } from "@/lib/markets/signing";
import type { TypedData } from "@/lib/markets/types";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const now = new Date("2026-10-03T12:00:00.000Z");
const owner = "0x1111111111111111111111111111111111111111";
const account = { address: owner as `0x${string}`, walletId: "wallet-1" };
const signature = `0x${"ab".repeat(65)}` as `0x${string}`;
const typedData: TypedData = { domain: { name: "Exchange", version: "1", chainId: 1337 }, types: { Agent: [{ name: "source", type: "string" }] },
  primaryType: "Agent", message: { source: "a" } };
let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't'),
    ('bob', 'bob', 't', 't');`);
  db = d1(sqlite);
  vi.stubEnv("PRIVY_APP_SECRET", "test-secret");
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); });

describe("customer signatures for a venue", () => {
  it("asks Privy to sign the exact typed data with the customer's wallet", async () => {
    const { request } = await createMarketSignature(db, "alice", account, "hyperliquid", "hyperliquid_approve_agent", typedData, { agent: "x" }, now);
    expect(request.url).toMatch(/\/v1\/wallets\/wallet-1\/rpc$/);
    expect(request.body).toEqual({ method: "eth_signTypedData_v4", chain_type: "ethereum",
      params: { typed_data: { domain: typedData.domain, types: typedData.types, primary_type: "Agent", message: typedData.message } } });
    expect(Number(request.headers["privy-request-expiry"])).toBe(now.getTime() + 5 * 60_000);
  });

  it("uses a request once, for its own customer, venue, and purpose, while it is live", async () => {
    const relay = vi.fn(async () => signature);
    const { requestId } = await createMarketSignature(db, "alice", account, "hyperliquid", "hyperliquid_approve_agent", typedData, { agent: "x" }, now);
    await expect(completeMarketSignature(db, "bob", account, "hyperliquid", ["hyperliquid_approve_agent"], requestId, "auth", now, relay))
      .rejects.toMatchObject({ code: "signature_mismatch" });
    await expect(completeMarketSignature(db, "alice", account, "polymarket", ["hyperliquid_approve_agent"], requestId, "auth", now, relay))
      .rejects.toMatchObject({ code: "signature_mismatch" });
    await expect(completeMarketSignature(db, "alice", account, "hyperliquid", ["hyperliquid_withdraw"], requestId, "auth", now, relay))
      .rejects.toMatchObject({ code: "signature_mismatch" });
    expect(relay).not.toHaveBeenCalled();
    const signed = await completeMarketSignature<{ agent: string }>(db, "alice", account, "hyperliquid", ["hyperliquid_approve_agent"], requestId, "auth", now, relay);
    expect(signed).toEqual({ typedData, context: { agent: "x" }, signature, purpose: "hyperliquid_approve_agent" });
    await expect(completeMarketSignature(db, "alice", account, "hyperliquid", ["hyperliquid_approve_agent"], requestId, "auth", now, relay))
      .rejects.toMatchObject({ code: "signature_expired" });
  });

  it("refuses an expired request, and reports Privy's refusal as nothing signed", async () => {
    const relay = vi.fn(async () => { throw Object.assign(new Error("bad"), { status: 401 }); });
    const first = await createMarketSignature(db, "alice", account, "polymarket", "polymarket_order", typedData, null, now);
    await expect(completeMarketSignature(db, "alice", account, "polymarket", ["polymarket_order"], first.requestId, "auth",
      new Date(now.getTime() + 5 * 60_000), relay)).rejects.toMatchObject({ code: "signature_expired" });
    const second = await createMarketSignature(db, "alice", account, "polymarket", "polymarket_order", typedData, null, now);
    await expect(completeMarketSignature(db, "alice", account, "polymarket", ["polymarket_order"], second.requestId, "auth", now, relay))
      .rejects.toMatchObject({ status: 403, code: "signature_rejected" });
  });
});

describe("venue credentials at rest", () => {
  const secret = Buffer.alloc(32, 7).toString("base64");

  it("opens only with the same key and the same customer and venue", async () => {
    const sealed = await sealCredentials({ key: "k", secret: "s" }, "alice:polymarket", secret);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain("\"s\"");
    expect(await openCredentials(sealed, "alice:polymarket", secret)).toEqual({ key: "k", secret: "s" });
    await expect(openCredentials(sealed, "bob:polymarket", secret)).rejects.toThrow();
    await expect(openCredentials(sealed, "alice:polymarket", Buffer.alloc(32, 8).toString("base64"))).rejects.toThrow();
    await expect(sealCredentials({}, "x", Buffer.alloc(16).toString("base64"))).rejects.toThrow(/32 bytes/);
  });
});

describe("venue connections and operations", () => {
  it("keeps one connection per venue for the wallet in use, and resets it when the wallet changes", async () => {
    await savePendingAccount(db, "alice", { venue: "hyperliquid", owner: owner.toUpperCase().replace("0X", "0x"), tradingWalletId: "tw", tradingWalletAddress: "0xAAAA" }, now);
    expect(await readMarketAccount(db, "alice", "hyperliquid", owner)).toMatchObject({ status: "pending", tradingWalletAddress: "0xaaaa" });
    await markAccountReady(db, "alice", "hyperliquid", owner, {}, now);
    expect(await readMarketAccount(db, "alice", "hyperliquid", owner)).toMatchObject({ status: "ready", approvedAt: now.toISOString() });
    expect(await readMarketAccount(db, "alice", "hyperliquid", "0x2222222222222222222222222222222222222222")).toBeNull();
    await savePendingAccount(db, "alice", { venue: "hyperliquid", owner: "0x2222222222222222222222222222222222222222" }, now);
    expect(await readMarketAccount(db, "alice", "hyperliquid", owner)).toBeNull();
    expect(await readMarketAccount(db, "alice", "hyperliquid", "0x2222222222222222222222222222222222222222"))
      .toMatchObject({ status: "pending", tradingWalletId: null, approvedAt: null });
  });

  it("records what was sent with the venue as source, newest first", async () => {
    await recordOperation(db, "alice", { venue: "polymarket", kind: "order", summary: { side: "buy" }, externalId: "o1", status: "accepted" }, now);
    await recordOperation(db, "alice", { venue: "polymarket", kind: "cancel", summary: {}, status: "rejected", reason: "gone" }, new Date(now.getTime() + 1000));
    const operations = await listOperations(db, "alice", "polymarket");
    expect(operations.map((item) => item.kind)).toEqual(["cancel", "order"]);
    expect(operations[1]).toMatchObject({ source: "Polymarket API", externalId: "o1", summary: { side: "buy" }, observedAt: now.toISOString() });
    expect(await listOperations(db, "alice", "hyperliquid")).toEqual([]);
  });
});

describe("Hyperliquid deposit credit", () => {
  const hash = `0x${"d".repeat(64)}`;
  const ledger = (entries: unknown[], ok = true) => vi.fn(async () => new Response(JSON.stringify(entries), { status: ok ? 200 : 500 })) as unknown as typeof fetch;

  it("reads a perps credit under LI.FI's hash, and ignores sends to someone else or to spot", async () => {
    const send = (destination: string, destinationDex = "") => [{ time: 1, hash, delta: { type: "send", token: "USDC", amount: "9.95", destination, destinationDex } }];
    expect(await observeHyperliquidCredit({ user: owner, hash, since: 0 }, ledger(send(owner))))
      .toEqual({ status: "observed", creditedRaw: "9950000", hash, time: 1 });
    expect(await observeHyperliquidCredit({ user: owner, hash, since: 0 }, ledger([{ time: 2, hash, delta: { type: "deposit", usdc: "5.000001" } }])))
      .toMatchObject({ creditedRaw: "5000001" });
    expect(await observeHyperliquidCredit({ user: owner, hash, since: 0 }, ledger(send("0x2222222222222222222222222222222222222222")))).toMatchObject({ creditedRaw: "0" });
    expect(await observeHyperliquidCredit({ user: owner, hash, since: 0 }, ledger(send(owner, "spot")))).toMatchObject({ creditedRaw: "0" });
  });

  it("tells missing apart from unavailable", async () => {
    expect(await observeHyperliquidCredit({ user: owner, hash, since: 0 }, ledger([]))).toEqual({ status: "missing" });
    expect(await observeHyperliquidCredit({ user: owner, hash, since: 0 }, ledger([], false))).toEqual({ status: "unavailable", reason: "hyperliquid_unavailable" });
    expect(await observeHyperliquidCredit({ user: owner, hash, since: 0 }, ledger([{ nope: 1 }]))).toEqual({ status: "unavailable", reason: "hyperliquid_malformed" });
  });
});

describe("switches for market money moves", () => {
  it("gates a deposit into Hyperliquid by perps, and a Polymarket deposit by predictions", () => {
    expect(routeFeatures({ crossChain: true, external: false, destinationChainId: 1337 })).toEqual(["perps"]);
    expect(routeFeatures({ crossChain: true, external: true, destinationChainId: 1337 })).toEqual(["cross_chain", "direct_transfers"]);
    expect(routeFeatures({ crossChain: true, external: false, destinationChainId: 42161 })).toEqual(["cross_chain"]);
    const transfer = { kind: "transfer", summary: { assetId: "8453:0xusdc", market: "polymarket" } } as unknown as StoredAction;
    expect(storedActionGates(transfer)).toEqual({ features: ["predictions"], assetIds: ["8453:0xusdc"] });
  });
});
