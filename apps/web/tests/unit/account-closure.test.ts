import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Holding } from "@/lib/overview/read";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const wallet = "0x1111111111111111111111111111111111111111";
const state = vi.hoisted(() => ({ db: null as D1Database | null, holdings: [] as unknown[] }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/admin", () => ({ requireOperationsAdmin: async () => ({ subjectReference: "operator-1" }) }));
vi.mock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => wallet }));
vi.mock("@/lib/overview/read", () => ({ readOverview: async () => ({ wallet, holdings: state.holdings, totals: {}, observedAt: "2026-09-28T00:00:00.000Z" }) }));
vi.mock("@/lib/auth/privy", () => ({ privyClient: () => ({
  utils: () => ({ auth: () => ({ verifyAccessToken: async () => ({ user_id: "alice", session_id: "s", expiration: 1 }) }) }),
  users: () => ({ _get: async (id: string) => ({ id }), getByEmailAddress: async () => { throw Object.assign(new Error("not found"), { status: 404 }); },
    getByWalletAddress: async () => ({ id: "alice" }) })
}) }));

const { checkClosure } = await import("@/lib/account/closure");
const { POST: close } = await import("@/app/api/ops/accounts/[subject]/close/route");
const { POST: reopen } = await import("@/app/api/ops/accounts/[subject]/reopen/route");
const { GET: find } = await import("@/app/api/ops/accounts/route");
const { requireVerifiedSubject } = await import("@/lib/auth/server");

const holding = (label: string, amountRaw: string | null, status: Holding["status"] = "observed") =>
  ({ id: label, group: "cash", label, symbol: label, decimals: 6, source: "base", status, amountRaw, usdCents: 0, observedAt: "t" }) satisfies Holding;
const params = { params: Promise.resolve({ subject: "alice" }) };
const post = (handler: typeof close, body: unknown) => handler(new Request("https://aura.test", { method: "POST", body: JSON.stringify(body) }), params);

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = schemaDatabase();
  state.db = d1(sqlite);
  state.holdings = [holding("USD Coin", "0")];
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');
    INSERT INTO security_profiles (subject_reference, updated_at) VALUES ('alice', 't');
    INSERT INTO aura_tags (tag, subject_reference, receiving_address, display_name, public_enabled, created_at, updated_at) VALUES ('alice', 'alice', '${wallet}', 'Alice', 1, 't', 't');`);
});
afterEach(() => sqlite.close());

describe("closing an account", () => {
  it("is possible only when the account holds nothing, every balance could be read, and nothing is in progress", async () => {
    expect(await checkClosure(state.db!, "alice")).toMatchObject({ eligible: true, blockers: [], wallet, closedAt: null });
    state.holdings = [holding("USD Coin", "1"), holding("Tether Gold", null, "unavailable")];
    expect((await checkClosure(state.db!, "alice")).blockers).toEqual(["It still holds USD Coin", "Tether Gold couldn't be read, so we can't confirm it's empty"]);
    state.holdings = [holding("USD Coin", "0")];
    sqlite.exec(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint, effects_json,
      counts_toward_limit, status, transaction_hash, created_at, expires_at, updated_at) VALUES ('a1', 'alice', '${wallet}', 'transfer', 8453, '{}',
      '[{"to":"${wallet}","value":"0","data":"0x"}]', 'fp', '[]', 1, 'submitted', '0x${"1".repeat(64)}', 't', 't', 't')`);
    expect((await checkClosure(state.db!, "alice")).blockers).toEqual(["A transaction is still in progress"]);
  });

  it("is refused by the server when the account isn't empty, whatever the console showed", async () => {
    state.holdings = [holding("USD Coin", "2500000")];
    expect(await (await post(close, { reason: "Support case 42" })).json()).toMatchObject({ error: "account_not_empty", message: expect.stringContaining("It still holds USD Coin") });
    expect(sqlite.prepare("SELECT closed_at FROM subject_profiles").get()).toEqual({ closed_at: null });
  });

  it("closes an empty account: locked, tag unpublished, audited, records kept; and can reopen it", async () => {
    const response = await post(close, { reason: "Support case 42" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ account: { closedAt: expect.any(String), closedReason: "Support case 42" } });
    expect(sqlite.prepare("SELECT closed_by FROM subject_profiles").get()).toEqual({ closed_by: "operator-1" });
    expect(sqlite.prepare("SELECT account_locked FROM security_profiles").get()).toEqual({ account_locked: 1 });
    expect(sqlite.prepare("SELECT public_enabled FROM aura_tags").get()).toEqual({ public_enabled: 0 });
    expect(sqlite.prepare("SELECT actor_reference, evidence_json FROM audit_events WHERE action = 'account.closed'").get())
      .toEqual({ actor_reference: "operator-1", evidence_json: JSON.stringify({ reason: "Support case 42" }) });
    expect(await (await post(close, { reason: "Again" })).json()).toMatchObject({ error: "already_closed" });

    expect((await post(reopen, { reason: "Customer came back" })).status).toBe(200);
    expect(sqlite.prepare("SELECT closed_at FROM subject_profiles").get()).toEqual({ closed_at: null });
    // It stays locked until the customer unlocks it with their passkey.
    expect(sqlite.prepare("SELECT account_locked FROM security_profiles").get()).toEqual({ account_locked: 1 });
    expect(await (await post(reopen, { reason: "Again" })).json()).toMatchObject({ error: "not_closed" });
  });

  it("finds a customer by wallet or Privy ID, and says when nobody matches", async () => {
    const lookup = (q: string) => find(new Request(`https://aura.test/api/ops/accounts?q=${encodeURIComponent(q)}`));
    expect(await (await lookup(wallet)).json()).toMatchObject({ account: { subjectReference: "alice", eligible: true } });
    expect(await (await lookup("did:privy:alice")).json()).toMatchObject({ account: { subjectReference: "did:privy:alice" } });
    expect((await lookup("nobody@example.com")).status).toBe(404);
    expect((await lookup("ab")).status).toBe(400);
  });

  it("refuses a closed account everywhere except support and the data export", async () => {
    const request = new Request("https://aura.test", { headers: { Authorization: "Bearer token" } });
    expect(await requireVerifiedSubject(request)).toMatchObject({ subjectReference: "alice" });
    await post(close, { reason: "Support case 42" });
    await expect(requireVerifiedSubject(request)).rejects.toMatchObject({ status: 403, code: "account_closed" });
    expect(await requireVerifiedSubject(request, { allowClosed: true })).toMatchObject({ subjectReference: "alice" });
  });
});
