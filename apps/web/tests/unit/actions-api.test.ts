import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
const state = vi.hoisted(() => ({ db: null as D1Database | null, verification: { status: "confirmed" } as unknown }));
const wallet = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "s" }) }));
vi.mock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => wallet, requireMoneyMfa: async () => undefined,
  requireMoneyAccount: async () => ({ address: wallet, walletId: "wallet-1" }), WalletOwnershipError: httpErrors.WalletOwnershipError }));
vi.mock("@/lib/actions/verify", () => ({ verifyAction: vi.fn(async () => state.verification) }));

const { POST: prepare } = await import("@/app/api/actions/route");
const { GET: status } = await import("@/app/api/actions/[id]/route");
const { POST: submit } = await import("@/app/api/actions/[id]/submit/route");
const { verifyAction } = await import("@/lib/actions/verify");

let sqlite: DatabaseSync;
const post = (body: unknown) => prepare(new Request("https://aura.test/api/actions", { method: "POST", body: JSON.stringify(body) }));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const send = { kind: "transfer", assetId: `8453:${usdc}`, amount: "12.5", to: recipient };

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec("UPDATE feature_flags SET enabled = 1");
  state.db = d1(sqlite);
  state.verification = { status: "confirmed" };
});
afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

describe("POST /api/actions", () => {
  it("prepares an exact token transfer from the server-chosen wallet", async () => {
    const response = await post(send);
    expect(response.status).toBe(201);
    const { action } = await response.json() as { action: { id: string; status: string; usdCents: number; calls: Array<{ to: string; data: `0x${string}` }> } };
    expect(action).toMatchObject({ status: "prepared", usdCents: 1250 });
    expect(action.calls).toHaveLength(1);
    expect(action.calls[0].to).toBe(usdc);
    expect(decodeFunctionData({ abi: erc20Abi, data: action.calls[0].data }).args).toEqual([recipient, 12_500_000n]);
    expect(sqlite.prepare("SELECT wallet_address, kind, counts_toward_limit FROM actions").get()).toEqual({ wallet_address: wallet, kind: "transfer", counts_toward_limit: 1 });
  });

  it("prepares an Aave deposit as one approval and supply", async () => {
    const response = await post({ kind: "earn", protocol: "aave", direction: "deposit", asset: "USDC", amount: "5" });
    expect(response.status).toBe(201);
    const { action } = await response.json() as { action: { calls: unknown[] } };
    expect(action.calls).toHaveLength(2);
    expect(sqlite.prepare("SELECT counts_toward_limit FROM actions").get()).toEqual({ counts_toward_limit: 0 });
  });

  it("explains why the customer's controls block an action", async () => {
    await post(send);
    sqlite.exec("UPDATE security_profiles SET daily_limit_cents = 2000");
    expect(await (await post(send)).json()).toMatchObject({ error: "daily_limit" });
    sqlite.exec("UPDATE security_profiles SET enforce_address_book = 1, daily_limit_cents = NULL");
    const blocked = await post(send);
    expect([blocked.status, (await blocked.json() as { error: string }).error]).toEqual([409, "recipient_not_saved"]);
    sqlite.exec("UPDATE security_profiles SET account_locked = 1");
    expect(await (await post(send)).json()).toMatchObject({ error: "account_locked" });
  });

  it("stays closed while the feature switch is off, and rejects invalid input", async () => {
    sqlite.exec("UPDATE feature_flags SET enabled = 0 WHERE flag_key = 'direct_transfers'");
    expect((await post(send)).status).toBe(503);
    expect((await post({ ...send, to: wallet })).status).toBe(422);
    expect((await post({ ...send, assetId: "1:native" })).status).toBe(422);
    expect((await post({ kind: "borrow" })).status).toBe(400);
  });

  it("refuses to send to a token contract, where the funds would be lost", async () => {
    const response = await post({ ...send, to: usdc });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "invalid_recipient", message: "That's a token contract, not a wallet. Check the address." });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM actions").get()).toEqual({ n: 0 });
  });

  it("sends only registered assets, and nothing in a paused one", async () => {
    const unlisted = await post({ ...send, assetId: "8453:0x1111111111111111111111111111111111111111" });
    expect([unlisted.status, (await unlisted.json() as { error: string }).error]).toEqual([422, "unsupported_asset"]);
    sqlite.exec(`INSERT INTO asset_pauses (asset_id, reason, paused_at, paused_by) VALUES ('${send.assetId}', 'Depeg', '2026-09-26T00:00:00Z', 'op')`);
    const paused = await post(send);
    expect([paused.status, (await paused.json() as { error: string }).error]).toEqual([503, "asset_paused"]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM actions").get()).toEqual({ n: 0 });
  });
});

describe("submitting and tracking an action", () => {
  async function prepared() {
    return (await (await post(send)).json() as { action: { id: string } }).action.id;
  }
  const hash = `0x${"a".repeat(64)}`;
  const report = (id: string, transactionHash = hash) =>
    submit(new Request(`https://aura.test/api/actions/${id}/submit`, { method: "POST", body: JSON.stringify({ transactionHash }) }), params(id));
  const read = (id: string) => status(new Request(`https://aura.test/api/actions/${id}`), params(id));

  it("binds the hash, then settles from chain verification", async () => {
    const id = await prepared();
    expect((await report(id)).status).toBe(202);
    const current = await (await read(id)).json() as { action: { status: string; calls?: unknown } };
    expect(current.action).toMatchObject({ status: "confirmed" });
    expect(current.action.calls).toBeUndefined();
    expect(verifyAction).toHaveBeenCalledWith(expect.objectContaining({ walletAddress: wallet, transactionHash: hash, chainId: 8453 }));
  });

  it("does not re-verify more often than every few seconds", async () => {
    state.verification = { status: "pending", reason: "finality" };
    const id = await prepared();
    await report(id);
    await read(id);
    await read(id);
    expect(verifyAction).toHaveBeenCalledTimes(1);
  });

  it("rejects a hash already bound to another action", async () => {
    const first = await prepared();
    const second = await prepared();
    await report(first);
    expect(await (await report(second)).json()).toMatchObject({ error: "hash_in_use" });
  });

  it("returns 404 for an unknown action", async () => {
    expect((await read("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});
