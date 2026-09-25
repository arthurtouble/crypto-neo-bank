import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
import { DatabaseSync } from "node:sqlite";

const state = vi.hoisted(() => ({ database: null as D1Database | null }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.database; } } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: httpErrors.AuthenticationError, requireVerifiedSubject: async () => ({ subjectReference: "alice" }) }));

import { POST } from "@/app/api/growth/consent/route";
import { hasConsent } from "@/lib/growth/consent-state";


function d1(db: DatabaseSync): D1Database {
  return { prepare(sql: string) { return { bind(...args: unknown[]) {
    const statement = db.prepare(sql), values = args as Array<string | number | null>;
    return { async first() { return statement.get(...values) ?? null; }, async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; } };
  } }; } } as unknown as D1Database;
}

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE growth_consent_events (consent_event_id TEXT PRIMARY KEY,
    subject_reference TEXT NOT NULL, purpose TEXT NOT NULL, action TEXT NOT NULL, notice_version TEXT NOT NULL, occurred_at TEXT NOT NULL);
    CREATE TABLE audit_events (audit_id TEXT PRIMARY KEY, subject_reference TEXT, actor_type TEXT NOT NULL,
    actor_reference TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_reference TEXT,
    evidence_json TEXT NOT NULL, occurred_at TEXT NOT NULL);`);
  state.database = d1(sqlite);
});
afterEach(() => { state.database = null; sqlite.close(); });

describe("marketing consent withdrawal", () => {
  it("accepts and records withdrawal even when the secondary audit write fails", async () => {
    sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    const response = await POST(new Request("https://aurel.test/api/growth/consent", {
      method: "POST", body: JSON.stringify({ purpose: "marketing", action: "withdrawn", noticeVersion: "2026-09-22" })
    }));
    expect(response.status).toBe(200);
    expect((await response.json()) as { updated: boolean }).toMatchObject({ updated: true });
    expect(sqlite.prepare("SELECT purpose, action, notice_version FROM growth_consent_events WHERE subject_reference='alice'").get())
      .toMatchObject({ purpose: "marketing", action: "withdrawn", notice_version: "2026-09-22" });
  });

  it("withdrawal suppresses a prior subject grant even when audit fails", async () => {
    sqlite.exec("INSERT INTO growth_consent_events VALUES ('grant-1','alice','marketing','granted','2026-09-22','2026-09-20T00:00:00.000Z')");
    expect(await hasConsent(state.database!, "alice", "marketing")).toBe(true);
    sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    expect((await POST(new Request("https://aurel.test/api/growth/consent", { method: "POST",
      body: JSON.stringify({ purpose: "marketing", action: "withdrawn", noticeVersion: "2026-09-22" }) }))).status).toBe(200);
    expect(await hasConsent(state.database!, "alice", "marketing")).toBe(false);
  });

  it("prefers withdrawal if grant and withdrawal share a timestamp", async () => {
    sqlite.exec(`INSERT INTO growth_consent_events VALUES ('grant-1','alice','marketing','granted','2026-09-22','2026-09-24T05:00:00.000Z');
      INSERT INTO growth_consent_events VALUES ('withdraw-1','alice','marketing','withdrawn','2026-09-22','2026-09-24T05:00:00.000Z');`);
    expect(await hasConsent(state.database!, "alice", "marketing")).toBe(false);
  });
});
