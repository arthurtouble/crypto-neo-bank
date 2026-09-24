import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";

const state = vi.hoisted(() => ({ database: null as D1Database | null }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.database; } } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class extends Error {}, requireVerifiedSubject: async () => ({ subjectReference: "alice" }) }));

import { GET as alerts, POST as createAlert, PATCH as cancelAlert } from "@/app/api/swap/alerts/route";
import { GET as reminders, POST as createReminder, PATCH as cancelReminder } from "@/app/api/swap/reminders/route";
import { GET as dueReminders } from "@/app/api/swap/reminders/due/route";

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
const id = "00000000-0000-4000-8000-000000000001";
const request = (path: string, method = "GET", body?: object) => new Request(`https://aura.test${path}`, { method, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE price_alerts (alert_id TEXT PRIMARY KEY, subject_reference TEXT, pair_id TEXT, direction TEXT, threshold_decimal TEXT,
    status TEXT, threshold_version INTEGER, armed INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE swap_reminder_plans (plan_id TEXT PRIMARY KEY, subject_reference TEXT, base_asset_id TEXT, quote_asset_id TEXT,
      amount_decimal TEXT, schedule_type TEXT, time_zone TEXT, anchor_local TEXT, status TEXT, next_due_at TEXT, plan_version INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE swap_reminder_occurrences (occurrence_id TEXT PRIMARY KEY, subject_reference TEXT, alert_id TEXT, plan_id TEXT, reminder_state TEXT, updated_at TEXT);
    CREATE TABLE audit_events (audit_id TEXT PRIMARY KEY, subject_reference TEXT, actor_type TEXT, actor_reference TEXT, action TEXT,
      target_type TEXT, target_reference TEXT, evidence_json TEXT, occurred_at TEXT);
    INSERT INTO price_alerts VALUES ('${id}','alice','ETH/USD','above','3000','active',1,1,'2026-09-23','2026-09-23');
    INSERT INTO swap_reminder_plans VALUES ('${id}','alice','ETH','USDC','10','weekly','UTC','2026-09-23T09:00','active','2026-10-01',1,'2026-09-23','2026-09-23');
    INSERT INTO swap_reminder_occurrences VALUES ('a','alice','${id}',NULL,'due','2026-09-23');
    INSERT INTO swap_reminder_occurrences VALUES ('p','alice',NULL,'${id}','due','2026-09-23');`);
  state.database = d1(sqlite);
});
afterEach(() => { state.database = null; sqlite.close(); });

describe("retired swap planning", () => {
  it("preserves history and rejects new alerts and reminders", async () => {
    expect((await (await alerts(request("/api/swap/alerts"))).json() as { alerts: unknown[] }).alerts).toHaveLength(1);
    expect((await (await reminders(request("/api/swap/reminders"))).json() as { plans: unknown[] }).plans).toHaveLength(1);
    expect((await createAlert(request("/api/swap/alerts", "POST", {}))).status).toBe(410);
    expect((await createReminder(request("/api/swap/reminders", "POST", {}))).status).toBe(410);
    expect((await dueReminders(request("/api/swap/reminders/due"))).status).toBe(410);
  });

  it("cancels existing plans, dismisses occurrences, and writes audits", async () => {
    expect((await cancelAlert(request("/api/swap/alerts", "PATCH", { alertId: id, version: 1, action: "cancel" }))).status).toBe(200);
    expect((await cancelReminder(request("/api/swap/reminders", "PATCH", { planId: id, version: 1, action: "cancel" }))).status).toBe(200);
    expect(sqlite.prepare("SELECT status FROM price_alerts").get()).toMatchObject({ status: "cancelled" });
    expect(sqlite.prepare("SELECT status FROM swap_reminder_plans").get()).toMatchObject({ status: "cancelled" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM swap_reminder_occurrences WHERE reminder_state='superseded'").get()).toMatchObject({ count: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get()).toMatchObject({ count: 2 });
  });

  it("cannot reactivate retired plans", async () => {
    expect((await cancelAlert(request("/api/swap/alerts", "PATCH", { alertId: id, version: 1, action: "resume" }))).status).toBe(400);
    expect((await cancelReminder(request("/api/swap/reminders", "PATCH", { planId: id, version: 1, action: "resume" }))).status).toBe(400);
  });
});
