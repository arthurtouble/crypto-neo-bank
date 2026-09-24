import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { changeSwapReminderPlan, createSwapReminderPlan, listSwapReminderPlans, materializeDueSwapReminders } from "@/lib/swap/reminder-store";

function d1(db: DatabaseSync): D1Database {
  const prepare = (sql: string) => ({ bind(...args: unknown[]) {
    const statement = db.prepare(sql);
    const values = args as Array<string | number | null>;
    return {
      async first() { return statement.get(...values) ?? null; },
      async all() { return { results: statement.all(...values) }; },
      async run() { const info = statement.run(...values); return { meta: { changes: Number(info.changes) } }; }
    };
  } });
  return { prepare, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    db.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
}

const now = new Date("2026-09-23T10:00:00.000Z");
const input = { fromAssetId: "8453:native", toAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "0.1", scheduleType: "weekly" as const, timeZone: "UTC", anchorLocal: "2026-09-23T09:00" };
const access = { mode: "invite" as const, countryCode: "PT", allowedCountries: ["PT"] };
let sqlite: DatabaseSync;
let database: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE subject_profiles(subject_reference TEXT PRIMARY KEY); CREATE TABLE security_profiles(subject_reference TEXT PRIMARY KEY,account_locked INTEGER NOT NULL); CREATE TABLE beta_access(subject_reference TEXT PRIMARY KEY,status TEXT NOT NULL,country_code TEXT NOT NULL); CREATE TABLE feature_flags(flag_key TEXT PRIMARY KEY,enabled INTEGER NOT NULL,audience TEXT NOT NULL); CREATE TABLE audit_events(audit_id TEXT PRIMARY KEY,subject_reference TEXT,actor_type TEXT NOT NULL,actor_reference TEXT NOT NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_reference TEXT,evidence_json TEXT NOT NULL,occurred_at TEXT NOT NULL); INSERT INTO subject_profiles VALUES ('alice'),('bob'); INSERT INTO security_profiles VALUES ('alice',0),('bob',0); INSERT INTO beta_access VALUES ('alice','active','PT'),('bob','active','PT'); INSERT INTO feature_flags VALUES ('swaps',1,'beta'),('cross_chain',1,'beta');");
  sqlite.exec(readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0022_price_alerts_swap_reminders.sql"), "utf8"));
  database = d1(sqlite);
});
afterEach(() => sqlite.close());

describe("approval-required Swap reminder storage", () => {
  it("stores a canonical preference, lists by subject, and never stores signing material", async () => {
    const created = await createSwapReminderPlan(database, "alice", input, access, now);
    expect(created.planVersion).toBe(1);
    expect((await listSwapReminderPlans(database, "alice"))[0]).toMatchObject({ planId: created.planId, fromAssetId: input.fromAssetId, toAssetId: input.toAssetId, amount: "0.1" });
    expect(await listSwapReminderPlans(database, "bob")).toEqual([]);
    expect(sqlite.prepare("SELECT * FROM swap_reminder_plans WHERE plan_id=?").get(created.planId)).not.toHaveProperty("wallet_signature");
  });
  it("rejects stale edits and cross-subject changes, and pause prevents due insertion", async () => {
    const created = await createSwapReminderPlan(database, "alice", input, access, now);
    expect(await changeSwapReminderPlan(database, "bob", { planId: created.planId, version: 1, action: "pause" }, null, now)).toBe(false);
    expect(await changeSwapReminderPlan(database, "alice", { planId: created.planId, version: 1, action: "pause" }, null, now)).toBe(true);
    expect(await changeSwapReminderPlan(database, "alice", { planId: created.planId, version: 1, action: "cancel" }, null, now)).toBe(false);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='swap.reminder.pause'").get()).toMatchObject({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='swap.reminder.cancel'").get()).toMatchObject({ count: 0 });
    expect(await materializeDueSwapReminders(database, "alice", new Date("2026-09-30T09:05:00Z"))).toEqual([]);
  });
  it("materializes a due instant once, even on repeated evaluation, and does not execute a trade", async () => {
    const created = await createSwapReminderPlan(database, "alice", input, access, now);
    const dueAt = "2026-09-30T09:00:00.000Z";
    sqlite.prepare("UPDATE swap_reminder_plans SET next_due_at=? WHERE plan_id=?").run(dueAt, created.planId);
    const first = await materializeDueSwapReminders(database, "alice", new Date("2026-09-30T09:05:00Z"));
    const second = await materializeDueSwapReminders(database, "alice", new Date("2026-09-30T09:06:00Z"));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).toMatchObject({ planId: created.planId, planVersion: 1, dueAt });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM swap_reminder_occurrences").get()).toMatchObject({ count: 1 });
    expect(await materializeDueSwapReminders(database, "bob", new Date("2026-09-30T09:06:00Z"))).toEqual([]);
  });
  it("expires old due times and supersedes old-version reminders on edit", async () => {
    const created = await createSwapReminderPlan(database, "alice", input, access, now);
    sqlite.prepare("UPDATE swap_reminder_plans SET next_due_at=? WHERE plan_id=?").run("2026-09-23T09:00:00.000Z", created.planId);
    expect(await materializeDueSwapReminders(database, "alice", new Date("2026-10-01T10:00:00Z"))).toEqual([]);
    sqlite.prepare("UPDATE swap_reminder_plans SET next_due_at=? WHERE plan_id=?").run("2026-10-07T09:00:00.000Z", created.planId);
    await materializeDueSwapReminders(database, "alice", new Date("2026-10-07T09:05:00Z"));
    expect(await changeSwapReminderPlan(database, "alice", { planId: created.planId, version: 1, action: "edit", amount: "0.2", scheduleType: "monthly", timeZone: "UTC", anchorLocal: "2026-10-08T09:00" }, access, new Date("2026-10-07T10:00:00Z"))).toBe(true);
    expect(sqlite.prepare("SELECT reminder_state FROM swap_reminder_occurrences WHERE plan_id=?").get(created.planId)).toMatchObject({ reminder_state: "superseded" });
    expect(sqlite.prepare("SELECT plan_version, amount_decimal FROM swap_reminder_plans WHERE plan_id=?").get(created.planId)).toMatchObject({ plan_version: 2, amount_decimal: "0.2" });
  });
  it("expires an existing due reminder after 24 hours", async () => {
    const created = await createSwapReminderPlan(database, "alice", input, access, now);
    sqlite.prepare("INSERT INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,plan_id,plan_version,due_at,created_at) VALUES ('old','alice','plan',?,1,'2026-09-24T09:00:00.000Z','2026-09-24T09:00:00.000Z')").run(created.planId);
    expect(await materializeDueSwapReminders(database, "alice", new Date("2026-09-26T10:00:00Z"))).toEqual([]);
    expect(sqlite.prepare("SELECT reminder_state FROM swap_reminder_occurrences WHERE occurrence_id='old'").get()).toMatchObject({ reminder_state: "expired" });
  });
  it("rolls back creation when audit storage fails and permits a clean retry", async () => {
    sqlite.exec("CREATE TRIGGER reject_reminder_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    await expect(createSwapReminderPlan(database, "alice", input, access, now)).rejects.toThrow("audit unavailable");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM swap_reminder_plans").get()).toMatchObject({ count: 0 });
    sqlite.exec("DROP TRIGGER reject_reminder_audit");
    await createSwapReminderPlan(database, "alice", input, access, now);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM swap_reminder_plans").get()).toMatchObject({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='swap.reminder.created'").get()).toMatchObject({ count: 1 });
  });
  it("rolls back a versioned change and supersession when audit storage fails", async () => {
    const created = await createSwapReminderPlan(database, "alice", input, access, now);
    sqlite.prepare("INSERT INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,plan_id,plan_version,due_at,created_at) VALUES ('due','alice','plan',?,1,'2026-09-30T09:00:00.000Z','2026-09-30T09:00:00.000Z')").run(created.planId);
    sqlite.exec("CREATE TRIGGER reject_reminder_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    await expect(changeSwapReminderPlan(database, "alice", { planId: created.planId, version: 1, action: "pause" }, null, now)).rejects.toThrow("audit unavailable");
    expect(sqlite.prepare("SELECT plan_version,status FROM swap_reminder_plans WHERE plan_id=?").get(created.planId)).toMatchObject({ plan_version: 1, status: "active" });
    expect(sqlite.prepare("SELECT reminder_state FROM swap_reminder_occurrences WHERE occurrence_id='due'").get()).toMatchObject({ reminder_state: "due" });
    sqlite.exec("DROP TRIGGER reject_reminder_audit");
    expect(await changeSwapReminderPlan(database, "alice", { planId: created.planId, version: 1, action: "pause" }, null, now)).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='swap.reminder.pause'").get()).toMatchObject({ count: 1 });
  });
});
