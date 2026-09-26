import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
const account = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const state = vi.hoisted(() => ({ db: null as D1Database | null, rpc: vi.fn(), signed: [] as unknown[], mfa: true }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "s" }) }));
vi.mock("@/lib/auth/wallet", () => ({
  requireActionWallet: async () => account,
  requireActionAccount: async () => ({ address: account, walletId: "wallet-1" }),
  requireMoneyMfa: async () => { if (!state.mfa) throw new httpErrors.MfaRequiredError(); },
  WalletOwnershipError: httpErrors.WalletOwnershipError
}));
vi.mock("@/lib/auth/privy", () => ({ privyClient: () => ({ wallets: () => ({ rpc: state.rpc }) }) }));
vi.mock("@/lib/swap/catalog", () => ({ resolveCatalogAsset: async (id: string) => id === `8453:${usdc}`
  ? { id, chainId: 8453, address: usdc, symbol: "USDC", name: "USD Coin", decimals: 6, logoUrl: null, verification: "verified", eligibility: "eligible" } : null }));

const { POST: prepare } = await import("@/app/api/actions/route");
const { POST: authorize } = await import("@/app/api/actions/[id]/authorize/route");
const { POST: submit } = await import("@/app/api/actions/[id]/submit/route");
const { checkAction } = await import("@/lib/actions/check");
const { getAction } = await import("@/lib/actions/store");

let sqlite: DatabaseSync;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body?: unknown) => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const signature = "MEUCIQDexampleexampleexampleexampleexampleexampleAiBexampleexampleexample==";

async function prepared(): Promise<string> {
  const response = await prepare(new Request("https://aura.test/api/actions", json({ kind: "transfer", assetId: `8453:${usdc}`, amount: "2", to: recipient })));
  return (await response.json() as { action: { id: string } }).action.id;
}

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec("UPDATE feature_flags SET enabled = 1");
  state.db = d1(sqlite);
  state.rpc = vi.fn(async () => ({ method: "wallet_sendCalls", data: { caip2: "eip155:8453", transaction_id: "tx-1" } }));
  state.mfa = true;
});
afterEach(() => sqlite.close());

describe("sending an action through Privy", () => {
  it("hands the customer the exact request to sign, then relays it with their signature", async () => {
    const id = await prepared();
    const { request } = await (await authorize(new Request("https://aura.test", json()), params(id))).json() as { request: { url: string; body: { sponsor: boolean; params: { calls: Array<{ to: string }> } } } };
    expect(request).toMatchObject({ url: "https://api.privy.io/v1/wallets/wallet-1/rpc", body: { sponsor: true, params: { calls: [{ to: usdc }] } } });

    expect((await submit(new Request("https://aura.test", json({ signature })), params(id))).status).toBe(202);
    expect(state.rpc).toHaveBeenCalledWith("wallet-1", expect.objectContaining({ ...request.body, idempotency_key: `aura-action-${id}`,
      authorization_context: { signatures: [signature] } }));
    expect(sqlite.prepare("SELECT status, relay_reference, transaction_hash FROM actions").get()).toEqual({ status: "submitted", relay_reference: "tx-1", transaction_hash: null });
    // A second submission can't send it again.
    expect((await submit(new Request("https://aura.test", json({ signature })), params(id))).status).toBe(409);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });

  it("sends nothing until the customer has a passkey or authenticator app", async () => {
    const id = await prepared();
    state.mfa = false;
    const response = await prepare(new Request("https://aura.test/api/actions", json({ kind: "transfer", assetId: `8453:${usdc}`, amount: "2", to: recipient })));
    expect([response.status, (await response.json() as { error: string }).error]).toEqual([403, "mfa_required"]);
    expect((await submit(new Request("https://aura.test", json({ signature })), params(id))).status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("tells a rejected request apart from one whose outcome is unknown", async () => {
    const id = await prepared();
    state.rpc = vi.fn(async () => { throw Object.assign(new Error("bad signature"), { status: 401 }); });
    expect(await (await submit(new Request("https://aura.test", json({ signature })), params(id))).json()).toMatchObject({ error: "relay_rejected" });
    state.rpc = vi.fn(async () => { throw new Error("socket hang up"); });
    expect(await (await submit(new Request("https://aura.test", json({ signature })), params(id))).json()).toMatchObject({ error: "relay_unconfirmed" });
    expect(sqlite.prepare("SELECT status FROM actions").get()).toEqual({ status: "prepared" });
  });

  it("waits for Privy's hash, then lets the chain decide", async () => {
    const id = await prepared();
    await submit(new Request("https://aura.test", json({ signature })), params(id));
    const db = d1(sqlite);
    const verify = vi.fn(async () => ({ status: "settling" as const, reason: "finality" }));
    const now = new Date();
    let action = await checkAction(db, (await getAction(db, "alice", id))!, now, { verify, relayStatus: async () => ({ status: "pending" }) });
    expect([action.status, verify.mock.calls.length]).toEqual(["submitted", 0]);
    const hash = `0x${"ab".repeat(32)}`;
    action = await checkAction(db, (await getAction(db, "alice", id))!, now, { verify, relayStatus: async () => ({ status: "landed", hash }) });
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ transactionHash: hash, walletAddress: account }));
    expect(sqlite.prepare("SELECT status, transaction_hash FROM actions").get()).toEqual({ status: "settling", transaction_hash: hash });
  });

  it("records a relay Privy reports as failed", async () => {
    const id = await prepared();
    await submit(new Request("https://aura.test", json({ signature })), params(id));
    const db = d1(sqlite);
    await checkAction(db, (await getAction(db, "alice", id))!, new Date(), { relayStatus: async () => ({ status: "failed", reason: "relay_failed" }) });
    expect(sqlite.prepare("SELECT status, failure_reason FROM actions").get()).toEqual({ status: "failed", failure_reason: "relay_failed" });
  });

  it("keeps the relay reference fixed and never lets an action settle without a chain hash", async () => {
    const id = await prepared();
    await submit(new Request("https://aura.test", json({ signature })), params(id));
    expect(() => sqlite.exec("UPDATE actions SET relay_reference = 'tx-2'")).toThrow(/immutable/);
    expect(() => sqlite.exec("UPDATE actions SET status = 'settling'")).toThrow(/forward/);
  });
});
