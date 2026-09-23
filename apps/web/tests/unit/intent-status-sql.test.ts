import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { REPORTED_HASH_CLAIM_SQL, TERMINAL_INTENT_CANCEL_SQL, TERMINAL_INTENT_FAIL_SQL, TERMINAL_INTENT_AUDIT_SQL, TERMINAL_PRODUCT_EVENT_SQL } from "@/lib/transactions/status-sql";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE transaction_intents (intent_id TEXT PRIMARY KEY, subject_reference TEXT NOT NULL, intent_type TEXT NOT NULL, status TEXT NOT NULL, transaction_hash TEXT, failure_reason TEXT, updated_at TEXT);
    CREATE TABLE intent_prepared_calls (intent_id TEXT NOT NULL, step_index INTEGER NOT NULL, subject_reference TEXT NOT NULL, reported_hash TEXT, verification_state TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE intent_events (event_id TEXT PRIMARY KEY, intent_id TEXT NOT NULL, subject_reference TEXT NOT NULL, event_type TEXT NOT NULL, evidence_json TEXT, occurred_at TEXT);
    CREATE TABLE product_events (event_id TEXT PRIMARY KEY, subject_reference TEXT NOT NULL, session_reference TEXT NOT NULL, event_name TEXT NOT NULL, surface TEXT NOT NULL, properties_json TEXT, occurred_at TEXT);`);
  db.prepare("INSERT INTO transaction_intents VALUES (?, ?, ?, ?, ?, ?, ?)").run("intent-a", "subject-a", "transfer", "reviewed", null, null, "2026-09-01T00:00:00.000Z");
  db.prepare("INSERT INTO intent_prepared_calls VALUES (?, ?, ?, ?, ?, ?)").run("intent-a", 0, "subject-a", null, "prepared", "2026-09-01T00:00:00.000Z");
  return db;
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
      const claim = db.prepare(REPORTED_HASH_CLAIM_SQL).run(`0x${"a".repeat(64)}`, "2026-09-01T00:02:00.000Z", "intent-a", 0, `0x${"a".repeat(64)}`, "subject-a");
      expect(claim.changes).toBe(0);
      expect(db.prepare("SELECT reported_hash FROM intent_prepared_calls").get()).toMatchObject({ reported_hash: null });
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
      const claim = db.prepare(REPORTED_HASH_CLAIM_SQL).run(`0x${"a".repeat(64)}`, "2026-09-01T00:01:00.000Z", "intent-a", 0, `0x${"a".repeat(64)}`, "subject-a");
      expect(claim.changes).toBe(1);
      expect(terminalBatch(db, "2026-09-01T00:02:00.000Z")).toEqual([0, 0, 0]);
      expect(db.prepare("SELECT status FROM transaction_intents").get()).toMatchObject({ status: "reviewed" });
    } finally { db.close(); }
  });
});
