import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";

const state = vi.hoisted(() => ({ database: null as D1Database | null }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.database; } } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class extends Error {}, requireVerifiedSubject: async () => ({ subjectReference: "alice" }) }));
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: async () => undefined }));
vi.mock("@/lib/beta/access", () => ({ BetaAccessError: class extends Error {}, requireBetaAccess: async () => undefined }));
vi.mock("@/lib/features/flags", () => ({ FeatureUnavailableError: class extends Error {}, requireFeature: async () => undefined }));

import { PATCH, POST } from "@/app/api/transfer-schedules/route";

function d1(db: DatabaseSync): D1Database {
  return { prepare(sql: string) { return { bind(...args: unknown[]) {
    const statement = db.prepare(sql), values = args as Array<string | number | null>;
    return { async first() { return statement.get(...values) ?? null; }, async all() { return { results: statement.all(...values) }; },
      async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; } };
  } }; }, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    db.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
}

let sqlite: DatabaseSync;
const address = "0x1111111111111111111111111111111111111111";
const scheduleId = "00000000-0000-4000-8000-000000000001";
function createRequest() {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
  return new Request("https://aurel.test/api/transfer-schedules", { method: "POST", body: JSON.stringify({
    scheduleType: "weekly", destinationKind: "wallet", destinationReference: address, destinationLabel: "Home",
    asset: "USDC", amount: "10", timeZone: "UTC", anchorLocal: tomorrow
  }) });
}
function pauseRequest() {
  return new Request("https://aurel.test/api/transfer-schedules", { method: "PATCH", body: JSON.stringify({ scheduleId, action: "pause" }) });
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE security_profiles (subject_reference TEXT PRIMARY KEY, account_locked INTEGER NOT NULL);
    CREATE TABLE address_book_entries (entry_id TEXT PRIMARY KEY, subject_reference TEXT NOT NULL, chain_family TEXT NOT NULL, address TEXT NOT NULL, available_at TEXT NOT NULL);
    CREATE TABLE transfer_schedules (schedule_id TEXT PRIMARY KEY, subject_reference TEXT NOT NULL, schedule_type TEXT NOT NULL,
      destination_kind TEXT NOT NULL, destination_reference TEXT NOT NULL, destination_label TEXT NOT NULL, rail TEXT, asset TEXT NOT NULL,
      amount TEXT NOT NULL, next_run_at TEXT NOT NULL, status TEXT NOT NULL, provider TEXT, provider_schedule_reference TEXT,
      time_zone TEXT, anchor_local TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE schedule_occurrences (occurrence_id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, subject_reference TEXT NOT NULL,
      reminder_state TEXT NOT NULL);
    CREATE TABLE audit_events (audit_id TEXT PRIMARY KEY, subject_reference TEXT, actor_type TEXT NOT NULL, actor_reference TEXT NOT NULL,
      action TEXT NOT NULL, target_type TEXT NOT NULL, target_reference TEXT, evidence_json TEXT NOT NULL, occurred_at TEXT NOT NULL);
    INSERT INTO security_profiles VALUES ('alice',0);
    INSERT INTO address_book_entries VALUES ('entry-1','alice','evm','${address}','2020-01-01T00:00:00.000Z');`);
  state.database = d1(sqlite);
});
afterEach(() => { state.database = null; sqlite.close(); });

describe("approval-required schedule audit atomicity", () => {
  it("does not create a plan when the required audit write fails", async () => {
    sqlite.exec("CREATE TRIGGER reject_schedule_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    expect((await POST(createRequest())).status).toBe(503);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM transfer_schedules").get()).toMatchObject({ count: 0 });
  });

  it("does not pause a plan or dismiss its reminder when the audit write fails", async () => {
    sqlite.prepare(`INSERT INTO transfer_schedules VALUES (?, 'alice', 'weekly', 'wallet', ?, 'Home', NULL, 'USDC', '10',
      '2026-10-01T12:00:00.000Z', 'approval_required', NULL, NULL, 'UTC', '2026-10-01T12:00', '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z')`).run(scheduleId, address);
    sqlite.prepare("INSERT INTO schedule_occurrences VALUES ('occ-1', ?, 'alice', 'due')").run(scheduleId);
    sqlite.exec("CREATE TRIGGER reject_schedule_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    expect((await PATCH(pauseRequest())).status).toBe(503);
    expect(sqlite.prepare("SELECT status FROM transfer_schedules WHERE schedule_id=?").get(scheduleId)).toMatchObject({ status: "approval_required" });
    expect(sqlite.prepare("SELECT reminder_state FROM schedule_occurrences WHERE occurrence_id='occ-1'").get()).toMatchObject({ reminder_state: "due" });
  });
});
