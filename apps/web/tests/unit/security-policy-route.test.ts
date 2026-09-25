import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const state = vi.hoisted(() => ({ db: null as D1Database | null }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "session-alice" }) }));
const { GET, PATCH } = await import("@/app/api/security/policy/route");

let sqlite: DatabaseSync;
beforeEach(() => { sqlite = schemaDatabase(); state.db = d1(sqlite); });
afterEach(() => sqlite.close());

const patch = (body: unknown) => PATCH(new Request("https://aura.test/api/security/policy", { method: "PATCH", body: JSON.stringify(body) }));
const read = async () => (await (await GET(new Request("https://aura.test/api/security/policy"))).json() as { policy: Record<string, unknown> }).policy;

describe("customer transaction controls", () => {
  it("starts with no limit, no recipient restriction, and a four-hour wait for new recipients", async () => {
    expect(await read()).toMatchObject({ accountLocked: false, enforceAddressBook: false, dailyLimitUsd: null, newAddressDelayHours: 4, enforcement: "aura" });
  });

  it("applies tightening and loosening immediately, with an audit record for each", async () => {
    expect((await patch({ accountLocked: true, dailyLimitUsd: 500 })).status).toBe(200);
    expect(await read()).toMatchObject({ accountLocked: true, dailyLimitUsd: 500, policyVersion: 2 });
    expect((await patch({ accountLocked: false, dailyLimitUsd: null })).status).toBe(200);
    expect(await read()).toMatchObject({ accountLocked: false, dailyLimitUsd: null, policyVersion: 3 });
    expect(sqlite.prepare("SELECT daily_limit_cents FROM security_profiles").get()).toEqual({ daily_limit_cents: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'security.policy.updated'").get()).toEqual({ n: 2 });
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
