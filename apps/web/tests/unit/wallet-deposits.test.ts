import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIFI_DIAMOND } from "@/lib/actions/lifi";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
const metamask = "0x2222222222222222222222222222222222222222";
const hash = `0x${"a".repeat(64)}`;
const landed = `0x${"b".repeat(64)}`;
const state = vi.hoisted(() => ({ db: null as D1Database | null, subject: "alice", tx: null as Record<string, unknown> | null, receipt: null as Record<string, unknown> | null,
  lifi: { status: "PENDING", substatus: undefined as string | undefined, receiving: undefined as unknown } }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: state.subject, sessionReference: "s" }) }));
vi.mock("@/lib/auth/wallet", () => ({
  requireLinkedEvmWallet: async (_subject: string, address: string) => {
    if (address.toLowerCase() !== metamask) throw new httpErrors.WalletOwnershipError();
    return address.toLowerCase();
  },
  WalletOwnershipError: httpErrors.WalletOwnershipError
}));
const { POST } = await import("@/app/api/deposits/route");
const { GET: status } = await import("@/app/api/deposits/status/route");
const { GET: methods } = await import("@/app/api/deposits/methods/route");
const { readWalletDeposits, walletDepositEntry } = await import("@/lib/deposits/tracking");
const { readHistory } = await import("@/lib/activity/history");
type IncomingRead = import("@/lib/activity/incoming").IncomingRead;

const body = { chainId: 42161, hash, tool: "across", symbol: "USDC", expectedAmountRaw: "39800000" };
const post = (input: unknown = body) => POST(new Request("https://aura.test/api/deposits", { method: "POST", body: JSON.stringify(input) }));
const rows = () => sqliteRef!.prepare("SELECT * FROM wallet_deposits").all() as Array<Record<string, unknown>>;
let sqliteRef: DatabaseSync | null = null;

describe("deposits bridged from the customer's own wallet", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => {
    sqlite = schemaDatabase();
    sqliteRef = sqlite;
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't'), ('bob', 'bob', 't', 't')`);
    state.db = d1(sqlite);
    state.subject = "alice";
    state.tx = { from: metamask, to: LIFI_DIAMOND };
    state.receipt = { status: "0x1" };
    state.lifi = { status: "PENDING", substatus: undefined, receiving: undefined };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/v1/status")) return Response.json({ status: state.lifi.status, substatus: state.lifi.substatus, tool: "across",
        sending: { txHash: hash, chainId: 42161 }, receiving: state.lifi.receiving });
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      return Response.json({ jsonrpc: "2.0", id: 1, result: method === "eth_getTransactionByHash" ? state.tx : state.receipt });
    }));
  });
  afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });

  it("keeps a landed bridge from the customer's linked wallet to the LI.FI Diamond, once", async () => {
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect(rows()).toEqual([expect.objectContaining({ source_hash: hash, subject_reference: "alice", source_chain_id: 42161, from_address: metamask,
      symbol: "USDC", decimals: 6, expected_amount_raw: "39800000", status: "pending", source: "LI.FI" })]);
  });

  it("refuses a transaction from another wallet, to another contract, that failed or hasn't landed, or that another customer kept", async () => {
    state.tx = { from: "0x3333333333333333333333333333333333333333", to: LIFI_DIAMOND };
    expect((await post()).status).toBe(403);
    state.tx = { from: metamask, to: "0x4444444444444444444444444444444444444444" };
    expect((await post()).status).toBe(422);
    state.tx = { from: metamask, to: LIFI_DIAMOND };
    state.receipt = { status: "0x0" };
    expect((await post()).status).toBe(422);
    state.receipt = null;
    expect((await post()).status).toBe(404);
    expect((await post({ ...body, chainId: 8453 })).status).toBe(422);
    expect(rows()).toEqual([]);
    state.receipt = { status: "0x1" };
    state.subject = "bob";
    expect((await post()).status).toBe(201);
    state.subject = "alice";
    expect((await post()).status).toBe(422);
  });

  it("takes LI.FI's progress from the status check, and a finished deposit stays finished", async () => {
    await post();
    state.lifi = { status: "DONE", substatus: "COMPLETED", receiving: { txHash: landed, chainId: 8453 } };
    const response = await status(new Request(`https://aura.test/api/deposits/status?chainId=42161&hash=${hash}&tool=across`));
    expect(await response.json()).toMatchObject({ status: "DONE", destinationHash: landed });
    expect(rows()[0]).toMatchObject({ status: "completed", destination_hash: landed });
    state.lifi = { status: "DONE", substatus: "REFUNDED", receiving: { txHash: landed, chainId: 42161 } };
    await status(new Request(`https://aura.test/api/deposits/status?chainId=42161&hash=${hash}&tool=across`));
    expect(rows()[0]).toMatchObject({ status: "completed" });
  });

  it("asks LI.FI about a deposit still on its way when Transactions is read", async () => {
    await post(undefined);
    const later = new Date(Date.now() + 60_000);
    state.lifi = { status: "DONE", substatus: "REFUNDED", receiving: { txHash: landed, chainId: 42161 } };
    const [deposit] = await readWalletDeposits(state.db!, "alice", later);
    expect(deposit).toMatchObject({ status: "refunded" });
    expect(walletDepositEntry(deposit)).toMatchObject({ origin: "deposit", type: "received", status: "failed", asset: "USDC", amount: "39.8",
      counterparty: "Your wallet on Arbitrum", failureReason: "The bridge sent it back to your wallet" });
  });

  it("shows a deposit in Transactions until its transfer on Base does, then labels that transfer as from the customer's wallet", async () => {
    await post();
    const none: IncomingRead = { status: "available", partial: false, transfers: [], observedAt: new Date().toISOString() };
    const deps = { refreshPayouts: async () => undefined, bankDeposits: async () => new Map(), aave: async () => ({ items: [], partial: false, sourceStatus: "available" as const }),
      cards: async () => ({ items: [], status: "available" as const, partial: false }), unitCents: async () => 100 };
    const travelling = await readHistory(state.db!, "alice", metamask, new Date(), { ...deps, readIncoming: async () => none });
    expect(travelling.entries).toEqual([expect.objectContaining({ id: `deposit:${hash}`, status: "pending", amount: "39.8" })]);

    sqlite.exec(`UPDATE wallet_deposits SET status = 'completed', destination_hash = '${landed}'`);
    const transfer = { id: "incoming:8453:x", chainId: 8453, transactionHash: landed, from: "0x5555555555555555555555555555555555555555", assetId: "8453:usdc",
      symbol: "USDC", decimals: 6, amountRaw: "39810000", amount: "39.81", blockNumber: 1, final: true, status: "completed" as const, source: "Alchemy", receivedAt: new Date().toISOString() };
    const arrived = await readHistory(state.db!, "alice", metamask, new Date(), { ...deps, readIncoming: async () => ({ ...none, transfers: [transfer] }) });
    expect(arrived.entries).toEqual([expect.objectContaining({ id: "incoming:8453:x", amount: "39.81", counterparty: "Your wallet on Arbitrum", source: "Alchemy · LI.FI" })]);
  });

  it("says whether card purchases are open", async () => {
    expect(await (await methods(new Request("https://aura.test/api/deposits/methods"))).json()).toMatchObject({ card: false });
    sqlite.exec("UPDATE feature_flags SET enabled = 1 WHERE flag_key = 'card_deposits'");
    expect(await (await methods(new Request("https://aura.test/api/deposits/methods"))).json()).toMatchObject({ card: true });
  });
});
