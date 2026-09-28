import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
const state = vi.hoisted(() => ({ db: null as D1Database | null, mfa: true, privy: "ok" as "ok" | "reject", signed: [] as unknown[] }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "session-alice" }) }));
vi.mock("@/lib/auth/privy", () => ({ privyClient: () => ({}) }));
vi.mock("@/lib/auth/wallet", () => ({
  requireActionAccount: async () => ({ address: "0x1111111111111111111111111111111111111111", walletId: "wallet-alice" }),
  requireMoneyMfa: async () => { if (!state.mfa) throw new httpErrors.MfaRequiredError(); }
}));
vi.mock("@/lib/actions/privy-relay", async (original) => ({ ...await original<object>(),
  // Privy signs only for a valid authorization signature from the customer, which their passkey unlocks.
  relayPersonalSign: async (_privy: unknown, walletId: string, request: unknown, signature: string) => {
    if (state.privy === "reject") throw Object.assign(new Error("Invalid authorization signature"), { status: 400 });
    state.signed.push({ walletId, request, signature });
    return "0xsigned";
  } }));
const { GET, PATCH } = await import("@/app/api/security/policy/route");

let sqlite: DatabaseSync;
beforeEach(() => { sqlite = schemaDatabase(); state.db = d1(sqlite); state.mfa = true; state.privy = "ok"; state.signed = []; });
afterEach(() => sqlite.close());

const patch = (body: unknown) => PATCH(new Request("https://aura.test/api/security/policy", { method: "PATCH", body: JSON.stringify(body) }));
const read = async () => (await (await GET(new Request("https://aura.test/api/security/policy"))).json() as { policy: Record<string, unknown> }).policy;

describe("customer transaction controls", () => {
  it("starts with no limit, no recipient restriction, and a four-hour wait for new recipients", async () => {
    expect(await read()).toMatchObject({ accountLocked: false, enforceAddressBook: false, dailyLimitUsd: null, newAddressDelayHours: 4, enforcement: "aura" });
  });

  const signature = "c2lnbmF0dXJlLW92ZXItdGhlLXByaXZ5LXJlcXVlc3QtZm9yLXRoaXMtY2hhbmdl";
  /** Ask for a loosening change, sign the confirmation it returns, and send it again. */
  async function loosen(changes: Record<string, unknown>) {
    const first = await patch(changes);
    expect(first.status).toBe(428);
    const body = await first.json() as { error: string; message: string; challengeId: string; request: { body: { method: string; params: { message: string } } } };
    return { body, confirm: (extra: Record<string, unknown> = {}) => patch({ ...changes, ...extra, confirmation: { challengeId: body.challengeId, signature } }) };
  }

  it("applies tightening at once, with an audit record", async () => {
    expect((await patch({ accountLocked: true, dailyLimitUsd: 500, enforceAddressBook: true, newAddressDelayHours: 24 })).status).toBe(200);
    expect(await read()).toMatchObject({ accountLocked: true, dailyLimitUsd: 500, enforceAddressBook: true, newAddressDelayHours: 24, policyVersion: 2 });
    expect((await patch({ dailyLimitUsd: 200 })).status).toBe(200);
    expect(state.signed).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'security.policy.updated'").get()).toEqual({ n: 2 });
  });

  it("needs a fresh passkey confirmation, checked by Privy, to loosen anything", async () => {
    await patch({ accountLocked: true, dailyLimitUsd: 500, enforceAddressBook: true, newAddressDelayHours: 24 });
    const { body, confirm } = await loosen({ accountLocked: false, dailyLimitUsd: null });
    expect(body).toMatchObject({ error: "confirmation_required", message: "Confirm with your passkey to unlock your account, remove your daily limit." });
    // What the customer's wallet signs names the change.
    expect(body.request.body).toMatchObject({ method: "personal_sign", params: { message: expect.stringContaining("unlock your account, remove your daily limit") } });
    expect(await read()).toMatchObject({ accountLocked: true, dailyLimitUsd: 500 });

    expect((await confirm()).status).toBe(200);
    expect(state.signed).toEqual([expect.objectContaining({ walletId: "wallet-alice", signature })]);
    expect(await read()).toMatchObject({ accountLocked: false, dailyLimitUsd: null, policyVersion: 3 });
    expect(JSON.parse((sqlite.prepare("SELECT evidence_json FROM audit_events WHERE action = 'security.policy.updated' ORDER BY occurred_at DESC LIMIT 1").get() as { evidence_json: string }).evidence_json))
      .toMatchObject({ confirmedWithPasskey: true });
    // Every other loosening needs one too.
    for (const change of [{ enforceAddressBook: false }, { newAddressDelayHours: 1 }]) expect((await patch(change)).status).toBe(428);
    await patch({ dailyLimitUsd: 100 });
    expect((await patch({ dailyLimitUsd: 1000 })).status).toBe(428);
  });

  it("refuses a confirmation that Privy rejects, is reused, or is for a different change", async () => {
    await patch({ accountLocked: true, dailyLimitUsd: 500 });
    state.privy = "reject";
    const rejected = await loosen({ accountLocked: false });
    expect(await (await rejected.confirm()).json()).toMatchObject({ error: "confirmation_rejected" });
    state.privy = "ok";
    const other = await loosen({ accountLocked: false });
    expect(await (await other.confirm({ dailyLimitUsd: null })).json()).toMatchObject({ error: "confirmation_mismatch" });
    const once = await loosen({ accountLocked: false });
    expect((await once.confirm()).status).toBe(200);
    await patch({ accountLocked: true });
    expect(await (await once.confirm()).json()).toMatchObject({ error: "confirmation_mismatch" });
    expect(await read()).toMatchObject({ accountLocked: true });
  });

  it("refuses to loosen without a passkey on the account", async () => {
    await patch({ accountLocked: true });
    state.mfa = false;
    expect(await (await patch({ accountLocked: false })).json()).toMatchObject({ error: "mfa_required" });
  });

  it("does not change controls if the audit record cannot be written", async () => {
    await read();
    sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    expect((await patch({ dailyLimitUsd: 100 })).status).toBe(503);
    expect(sqlite.prepare("SELECT daily_limit_cents, policy_version FROM security_profiles").get()).toEqual({ daily_limit_cents: null, policy_version: 1 });
  });

  it("rejects empty and unknown changes", async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ stepUpThresholdUsd: 1 })).status).toBe(400);
    expect((await patch({ newAddressDelayHours: 500 })).status).toBe(400);
  });
});
