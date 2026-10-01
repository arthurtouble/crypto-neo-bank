import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
const state = vi.hoisted(() => ({ db: null as D1Database | null, identity: { status: "pending" } as unknown }));
const wallet = "0x1111111111111111111111111111111111111111";
const stranger = "0x3333333333333333333333333333333333333333";
const recipient = "0x2222222222222222222222222222222222222222";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "s" }) }));
vi.mock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => wallet, requireMoneyMfa: async () => undefined,
  requireMoneyAccount: async () => ({ address: wallet, walletId: "wallet-1" }), WalletOwnershipError: httpErrors.WalletOwnershipError }));
// What the chain shows for a reported hash: the transaction's sender, target, and input.
vi.mock("@/lib/actions/chain", async (importOriginal) => ({ ...await importOriginal<object>(),
  observeTransactionIdentity: vi.fn(async () => state.identity) }));

const { POST: prepare } = await import("@/app/api/actions/route");
const { POST: submit } = await import("@/app/api/actions/[id]/submit/route");
const { checkAction } = await import("@/lib/actions/check");
const { recheckOpenActions } = await import("@/lib/actions/recheck");
const { getAction } = await import("@/lib/actions/store");
const { readHistory } = await import("@/lib/activity/history");

let sqlite: DatabaseSync;
const hash = `0x${"a".repeat(64)}`;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const report = (id: string, transactionHash = hash) =>
  submit(new Request(`https://aura.test/api/actions/${id}/submit`, { method: "POST", body: JSON.stringify({ transactionHash }) }), params(id));
const row = (id: string) => sqlite.prepare("SELECT status, transaction_hash FROM actions WHERE action_id = ?").get(id);

async function prepared(): Promise<{ id: string; calls: Array<{ to: string; value: string; data: string }> }> {
  const response = await prepare(new Request("https://aura.test/api/actions", { method: "POST",
    body: JSON.stringify({ kind: "transfer", assetId: `8453:${usdc}`, amount: "2", to: recipient }) }));
  return (await response.json() as { action: { id: string; calls: Array<{ to: string; value: string; data: string }> } }).action;
}
const sentBy = (from: string, call: { to: string; data: string }) =>
  ({ status: "found", call: { chainId: 8453, from, to: call.to, value: "0", data: call.data }, blockHash: null });

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec("UPDATE feature_flags SET enabled = 1");
  state.db = d1(sqlite);
  state.identity = { status: "pending" };
});
afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

describe("a transaction hash reported by the customer's wallet", () => {
  it("is bound only when the chain shows the customer's own wallet sent exactly the prepared calls", async () => {
    const action = await prepared();
    state.identity = sentBy(wallet, action.calls[0]);
    expect((await report(action.id)).status).toBe(202);
    expect(row(action.id)).toEqual({ status: "submitted", transaction_hash: hash });
  });

  it("is refused when the transaction belongs to someone else, so another customer's hash can't be squatted", async () => {
    const action = await prepared();
    state.identity = sentBy(stranger, action.calls[0]);
    const response = await report(action.id);
    expect([response.status, (await response.json() as { error: string }).error]).toEqual([409, "transaction_not_yours"]);
    // The wallet's own transaction, but not the calls Aura prepared.
    state.identity = sentBy(wallet, { to: usdc, data: "0xa9059cbb" });
    expect(await (await report(action.id)).json()).toMatchObject({ error: "transaction_not_yours" });
    expect(row(action.id)).toEqual({ status: "prepared", transaction_hash: null });
  });

  it("is refused, not bound, while the chain can't show the transaction yet", async () => {
    const action = await prepared();
    state.identity = { status: "pending" };
    const response = await report(action.id);
    expect([response.status, (await response.json() as { error: string }).error]).toEqual([409, "transaction_unavailable"]);
    expect(row(action.id)).toEqual({ status: "prepared", transaction_hash: null });
  });

  it("is stopped by a lock, a switch turned off, or a paused asset, like a relayed send", async () => {
    const action = await prepared();
    state.identity = sentBy(wallet, action.calls[0]);
    sqlite.exec("UPDATE security_profiles SET account_locked = 1");
    expect(await (await report(action.id)).json()).toMatchObject({ error: "account_locked" });
    sqlite.exec("UPDATE security_profiles SET account_locked = 0; UPDATE feature_flags SET enabled = 0 WHERE flag_key = 'direct_transfers'");
    expect(await (await report(action.id)).json()).toMatchObject({ error: "feature_unavailable" });
    sqlite.exec(`UPDATE feature_flags SET enabled = 1; INSERT INTO asset_pauses (asset_id, reason, paused_at, paused_by) VALUES ('8453:${usdc}', 'Issuer incident', 't', 'ops')`);
    expect(await (await report(action.id)).json()).toMatchObject({ error: "asset_paused" });
    expect(row(action.id)).toEqual({ status: "prepared", transaction_hash: null });
  });

  it("doesn't bring back an action whose signing window has passed", async () => {
    const action = await prepared();
    state.identity = sentBy(wallet, action.calls[0]);
    sqlite.exec(`UPDATE actions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE action_id = '${action.id}'`);
    expect(await (await report(action.id)).json()).toMatchObject({ error: "not_submittable" });
    expect(row(action.id)).toEqual({ status: "expired", transaction_hash: null });
  });
});

describe("a hash that is already linked to another action", () => {
  const now = new Date();
  const insert = (id: string, fields: { hash?: string; relay?: string; checkedAt?: string }) => sqlite.exec(`INSERT INTO actions (action_id, subject_reference,
    wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint, effects_json, counts_toward_limit, status, transaction_hash,
    relay_reference, checked_at, created_at, expires_at, updated_at) VALUES ('${id}', 'alice', '${wallet}', 'transfer', 8453, '{}',
    '[{"to":"${recipient}","value":"0","data":"0x"}]', 'fp-${id}', '[]', 1, 'submitted', ${fields.hash ? `'${fields.hash}'` : "NULL"},
    ${fields.relay ? `'${fields.relay}'` : "NULL"}, ${fields.checkedAt ? `'${fields.checkedAt}'` : "NULL"}, '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}')`);
  beforeEach(() => {
    sqlite.exec("INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't')");
  });

  it("is recorded as evidence on a relayed action instead of failing its check", async () => {
    insert("owner", { hash, checkedAt: now.toISOString() });
    insert("relayed", { relay: "tx-1" });
    const db = d1(sqlite);
    const checked = await checkAction(db, (await getAction(db, "alice", "relayed"))!, now, { relayStatus: async () => ({ status: "landed", hash }) });
    expect(checked.status).toBe("submitted");
    expect(row("relayed")).toEqual({ status: "submitted", transaction_hash: null });
    expect(sqlite.prepare("SELECT event_type, evidence_json FROM action_events WHERE action_id = 'relayed'").all())
      .toEqual([{ event_type: "hash_in_use", evidence_json: JSON.stringify({ transactionHash: hash }) }]);
  });

  it("doesn't stop the background check of every other action", async () => {
    insert("owner", { hash, checkedAt: now.toISOString() });
    insert("relayed", { relay: "tx-1" });
    insert("other", { relay: "tx-2" });
    const other = `0x${"b".repeat(64)}`;
    const summary = await recheckOpenActions(d1(sqlite), now, {
      relayStatus: async (reference) => ({ status: "landed", hash: reference === "tx-1" ? hash : other }),
      verify: async () => ({ status: "confirmed" })
    });
    expect(row("other")).toEqual({ status: "confirmed", transaction_hash: other });
    expect(summary).toMatchObject({ checked: 2, advanced: 1 });
  });

  it("one action whose check throws is skipped by the background check and by Transactions", async () => {
    insert("broken", { relay: "tx-1" });
    insert("fine", { relay: "tx-2" });
    const db = d1(sqlite);
    const check = vi.fn(async (_db: D1Database, action: { id: string }) => {
      if (action.id === "broken") throw new Error("D1 hiccup");
      return { ...(await getAction(db, "alice", action.id))!, status: "confirmed" as const };
    });
    expect(await recheckOpenActions(db, now, { check })).toMatchObject({ checked: 2, advanced: 1, failedChecks: 1 });
    const history = await readHistory(db, "alice", wallet, now, { check, refreshPayouts: async () => undefined,
      readIncoming: async () => ({ transfers: [], status: "available", partial: false, observedAt: now.toISOString() }),
      aave: async () => ({ items: [], partial: false, sourceStatus: "available" }), bankDeposits: async () => new Map(),
      cards: async () => ({ items: [], status: "available", partial: false }) });
    expect(history.entries.map((entry) => entry.status).sort()).toEqual(["completed", "pending"]);
  });
});
