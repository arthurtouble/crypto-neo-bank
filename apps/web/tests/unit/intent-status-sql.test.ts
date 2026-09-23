import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { REPORTED_HASH_CLAIM_SQL, TERMINAL_INTENT_CANCEL_SQL, TERMINAL_INTENT_FAIL_SQL, TERMINAL_INTENT_AUDIT_SQL, TERMINAL_PRODUCT_EVENT_SQL } from "@/lib/transactions/status-sql";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE transaction_intents (intent_id TEXT PRIMARY KEY, subject_reference TEXT NOT NULL, intent_type TEXT NOT NULL, status TEXT NOT NULL, transaction_hash TEXT, failure_reason TEXT, updated_at TEXT, expires_at TEXT);
    CREATE TABLE intent_prepared_calls (intent_id TEXT NOT NULL, step_index INTEGER NOT NULL, subject_reference TEXT NOT NULL, reported_hash TEXT, verification_state TEXT NOT NULL, updated_at TEXT, submission_phase TEXT DEFAULT 'legacy', expires_at TEXT);
    CREATE TABLE security_profiles (subject_reference TEXT PRIMARY KEY, account_locked INTEGER NOT NULL);
    CREATE TABLE beta_access (subject_reference TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE feature_flags (flag_key TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
    CREATE TABLE intent_events (event_id TEXT PRIMARY KEY, intent_id TEXT NOT NULL, subject_reference TEXT NOT NULL, event_type TEXT NOT NULL, evidence_json TEXT, occurred_at TEXT);
    CREATE TABLE product_events (event_id TEXT PRIMARY KEY, subject_reference TEXT NOT NULL, session_reference TEXT NOT NULL, event_name TEXT NOT NULL, surface TEXT NOT NULL, properties_json TEXT, occurred_at TEXT);`);
  db.prepare("INSERT INTO transaction_intents VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("intent-a", "subject-a", "transfer", "reviewed", null, null, "2026-09-01T00:00:00.000Z", "2026-09-01T00:10:00.000Z");
  db.prepare("INSERT INTO intent_prepared_calls (intent_id, step_index, subject_reference, reported_hash, verification_state, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("intent-a", 0, "subject-a", null, "prepared", "2026-09-01T00:00:00.000Z", "2026-09-01T00:10:00.000Z");
  db.exec("INSERT INTO security_profiles VALUES ('subject-a', 0); INSERT INTO beta_access VALUES ('subject-a', 'active'); INSERT INTO feature_flags VALUES ('direct_transfers', 1)");
  return db;
}

function claim(db: DatabaseSync, now: string, hash = `0x${"a".repeat(64)}`) {
  return db.prepare(REPORTED_HASH_CLAIM_SQL).run(hash, now, "intent-a", 0, hash, now, "subject-a", now, "invite", "direct_transfers");
}

function terminalBatch(db: DatabaseSync, now: string) {
  const eventId = `event-${now}`;
  db.exec("BEGIN");
  try {
    const update = db.prepare(TERMINAL_INTENT_CANCEL_SQL).run(now, "intent-a", "subject-a");
    const audit = db.prepare(TERMINAL_INTENT_AUDIT_SQL).run(eventId, "intent_cancelled", "{}", now, "intent-a", "subject-a", "cancelled", now, "intent-a", "intent_cancelled", now);
    const product = db.prepare(TERMINAL_PRODUCT_EVENT_SQL).run(`product-${now}`, "subject-a", "session-a", "transaction_prepared", "{}", now, eventId, "intent-a", "subject-a");
    db.exec("COMMIT");
    return [update.changes, audit.changes, product.changes];
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

describe("intent terminal SQL", () => {
  it("commits cancellation and both audit records together", () => {
    const db = database();
    try {
      expect(terminalBatch(db, "2026-09-01T00:01:00.000Z")).toEqual([1, 1, 1]);
      expect(db.prepare("SELECT status FROM transaction_intents").get()).toMatchObject({ status: "cancelled" });
      expect(db.prepare("SELECT count(*) AS count FROM intent_events").get()).toMatchObject({ count: 1 });
      expect(db.prepare("SELECT count(*) AS count FROM product_events").get()).toMatchObject({ count: 1 });
      expect(terminalBatch(db, "2026-09-01T00:02:00.000Z")).toEqual([0, 0, 0]);
    } finally { db.close(); }
  });

  it("rolls back the terminal state if the audit insert fails", () => {
    const db = database();
    try {
      db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON intent_events BEGIN SELECT RAISE(ABORT, 'audit offline'); END");
      expect(() => terminalBatch(db, "2026-09-01T00:01:00.000Z")).toThrow();
      expect(db.prepare("SELECT status FROM transaction_intents").get()).toMatchObject({ status: "reviewed" });
      expect(db.prepare("SELECT count(*) AS count FROM intent_events").get()).toMatchObject({ count: 0 });
    } finally { db.close(); }
  });

  it("cannot claim a hash after cancellation wins", () => {
    const db = database();
    try {
      expect(terminalBatch(db, "2026-09-01T00:01:00.000Z")[0]).toBe(1);
      const claimResult = claim(db, "2026-09-01T00:02:00.000Z");
      expect(claimResult.changes).toBe(0);
      expect(db.prepare("SELECT reported_hash FROM intent_prepared_calls").get()).toMatchObject({ reported_hash: null });
    } finally { db.close(); }
  });

  it.each(["feature", "lock", "beta", "expiry"] as const)("cannot claim a hash after %s control closes", (control) => {
    const db = database();
    try {
      if (control === "feature") db.exec("UPDATE feature_flags SET enabled = 0");
      if (control === "lock") db.exec("UPDATE security_profiles SET account_locked = 1");
      if (control === "beta") db.exec("UPDATE beta_access SET status = 'suspended'");
      if (control === "expiry") db.exec("UPDATE intent_prepared_calls SET expires_at = '2026-09-01T00:01:00.000Z'");
      expect(claim(db, "2026-09-01T00:02:00.000Z").changes).toBe(0);
      expect(db.prepare("SELECT reported_hash FROM intent_prepared_calls").get()).toMatchObject({ reported_hash: null });
    } finally { db.close(); }
  });

  it("cannot claim a hash for an awaiting step-up plan", () => {
    const db = database();
    try {
      db.exec("UPDATE intent_prepared_calls SET submission_phase = 'awaiting_step_up'");
      const claimResult = claim(db, "2026-09-01T00:02:00.000Z");
      expect(claimResult.changes).toBe(0);
      expect(db.prepare("SELECT reported_hash, verification_state FROM intent_prepared_calls").get())
        .toMatchObject({ reported_hash: null, verification_state: "prepared" });
    } finally { db.close(); }
  });

  it("continues to accept a hash for pre-migration prepared evidence", () => {
    const db = database();
    try {
      db.exec("UPDATE intent_prepared_calls SET submission_phase = NULL");
      const hash = `0x${"a".repeat(64)}`;
      expect(claim(db, "2026-09-01T00:02:00.000Z", hash).changes).toBe(1);
      expect(db.prepare("SELECT reported_hash, verification_state FROM intent_prepared_calls").get())
        .toMatchObject({ reported_hash: hash, verification_state: "pending" });
    } finally { db.close(); }
  });

  it.each(["swap", "bridge"])("refuses a customer failure claim for a reviewed %s at the SQL boundary", (intentType) => {
    const db = database();
    try {
      db.prepare("UPDATE transaction_intents SET intent_type = ?").run(intentType);
      const failure = db.prepare(TERMINAL_INTENT_FAIL_SQL).run("browser claim", "2026-09-01T00:01:00.000Z", "intent-a", "subject-a");
      expect(failure.changes).toBe(0);
      expect(db.prepare("SELECT status FROM transaction_intents").get()).toMatchObject({ status: "reviewed" });
    } finally { db.close(); }
  });

  it("still permits cancellation of an unsent reviewed swap", () => {
    const db = database();
    try {
      db.prepare("UPDATE transaction_intents SET intent_type = 'swap'").run();
      expect(db.prepare(TERMINAL_INTENT_CANCEL_SQL).run("2026-09-01T00:01:00.000Z", "intent-a", "subject-a").changes).toBe(1);
      expect(db.prepare("SELECT status FROM transaction_intents").get()).toMatchObject({ status: "cancelled" });
    } finally { db.close(); }
  });

  it("cannot cancel after a reported but unindexed hash wins", () => {
    const db = database();
    try {
      const claimResult = claim(db, "2026-09-01T00:01:00.000Z");
      expect(claimResult.changes).toBe(1);
      expect(terminalBatch(db, "2026-09-01T00:02:00.000Z")).toEqual([0, 0, 0]);
      expect(db.prepare("SELECT status FROM transaction_intents").get()).toMatchObject({ status: "reviewed" });
    } finally { db.close(); }
  });
});
