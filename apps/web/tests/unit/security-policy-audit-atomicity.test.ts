import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";

const state = vi.hoisted(() => ({ database: null as D1Database | null }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.database; } } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class extends Error {}, requireVerifiedSubject: async () => ({
  subjectReference: "alice", sessionReference: "session-alice"
}) }));
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));

import { PATCH } from "@/app/api/security/policy/route";

function d1(db: DatabaseSync): D1Database {
  return { prepare(sql: string) { return { bind(...args: unknown[]) {
    const statement = db.prepare(sql), values = args as Array<string | number | null>;
    return { async first() { return statement.get(...values) ?? null; }, async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; } };
  } }; }, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    db.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
}

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE security_profiles (
    subject_reference TEXT PRIMARY KEY, account_locked INTEGER NOT NULL, enforce_address_book INTEGER NOT NULL,
    daily_limit_usd REAL NOT NULL, new_address_threshold_usd REAL NOT NULL, new_address_delay_seconds INTEGER NOT NULL,
    step_up_threshold_usd REAL NOT NULL, policy_version INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE audit_events (audit_id TEXT PRIMARY KEY, subject_reference TEXT, actor_type TEXT NOT NULL,
      actor_reference TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_reference TEXT,
      evidence_json TEXT NOT NULL, occurred_at TEXT NOT NULL);
    CREATE TABLE product_events (event_id TEXT PRIMARY KEY, subject_reference TEXT, session_reference TEXT NOT NULL,
      event_name TEXT NOT NULL, surface TEXT NOT NULL, properties_json TEXT NOT NULL, occurred_at TEXT NOT NULL);
    INSERT INTO security_profiles VALUES ('alice',0,0,25000,1000,86400,10000,4,'2026-09-23T00:00:00Z');`);
  state.database = d1(sqlite);
});
afterEach(() => { state.database = null; sqlite.close(); });

const tighten = () => PATCH(new Request("https://aurel.test/api/security/policy", { method: "PATCH", body: JSON.stringify({ dailyLimitUsd: 20000 }) }));

describe("security policy audit atomicity", () => {
  it("does not change controls if durable audit persistence fails", async () => {
    sqlite.exec("CREATE TRIGGER reject_security_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    expect((await tighten()).status).toBe(503);
    expect(sqlite.prepare("SELECT daily_limit_usd, policy_version FROM security_profiles WHERE subject_reference='alice'").get())
      .toMatchObject({ daily_limit_usd: 25000, policy_version: 4 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM product_events").get()).toMatchObject({ count: 0 });
  });

  it("keeps a tightened control and its audit record when optional analytics fails", async () => {
    sqlite.exec("CREATE TRIGGER reject_product_event BEFORE INSERT ON product_events BEGIN SELECT RAISE(FAIL, 'analytics unavailable'); END;");
    expect((await tighten()).status).toBe(200);
    expect(sqlite.prepare("SELECT daily_limit_usd, policy_version FROM security_profiles WHERE subject_reference='alice'").get())
      .toMatchObject({ daily_limit_usd: 20000, policy_version: 5 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='security.policy.updated'").get())
      .toMatchObject({ count: 1 });
  });
});
