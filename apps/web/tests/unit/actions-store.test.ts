import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertAction, loadControls, type NewAction } from "@/lib/actions/controls";
import { applyVerification, expireIfStale, getAction, recordSubmission } from "@/lib/actions/store";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const now = new Date("2026-09-25T12:00:00.000Z");
const wallet = "0x1111111111111111111111111111111111111111";
const hash = `0x${"a".repeat(64)}`;
let sqlite: DatabaseSync;
let db: D1Database;

function action(overrides: Partial<NewAction> = {}): NewAction {
  return { subject: "alice", wallet, kind: "transfer", chainId: 8453, summary: { amount: "1" },
    calls: [{ to: "0x2222222222222222222222222222222222222222", value: "1", data: "0x" }], callsFingerprint: "0xfp",
    effects: [], countsTowardLimit: true, usdCents: 10_000, valuationSource: "test", routeQuoteId: null, destinationChainId: null, ...overrides };
}

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');
    INSERT INTO security_profiles (subject_reference, updated_at) VALUES ('alice', 't');`);
  db = d1(sqlite);
});
afterEach(() => sqlite.close());

const setProfile = (sql: string) => sqlite.exec(`UPDATE security_profiles SET ${sql} WHERE subject_reference = 'alice'`);

describe("preparing actions against the customer's controls", () => {
  it("stores an action with no limit set, and never on a locked account", async () => {
    expect(await insertAction(db, action({ usdCents: null }), now)).toMatch(/^[0-9a-f-]{36}$/);
    setProfile("account_locked = 1");
    expect(await insertAction(db, action(), now)).toBeNull();
  });

  it("enforces the daily limit inside the insert, counting open and settled outgoing actions", async () => {
    setProfile("daily_limit_cents = 25000");
    expect(await insertAction(db, action(), now)).not.toBeNull();
    expect(await insertAction(db, action(), now)).not.toBeNull();
    expect(await insertAction(db, action(), now)).toBeNull();
    // Moving between the customer's own positions does not count.
    expect(await insertAction(db, action({ kind: "earn", countsTowardLimit: false }), now)).not.toBeNull();
    // Prepared actions stop counting once they expire unsigned.
    expect(await insertAction(db, action(), new Date(now.getTime() + 11 * 60_000))).not.toBeNull();
  });

  it("fails closed when a limit is set and a value is unknown", async () => {
    expect(await insertAction(db, action({ usdCents: null }), now)).not.toBeNull();
    setProfile("daily_limit_cents = 1000000");
    expect(await insertAction(db, action(), now)).toBeNull();
    expect(await insertAction(db, action({ usdCents: null, countsTowardLimit: true }), new Date(now.getTime() + 11 * 60_000))).toBeNull();
  });

  it("reports controls and recipient state for the checks shown to the customer", async () => {
    setProfile("daily_limit_cents = 50000, enforce_address_book = 1");
    await insertAction(db, action(), now);
    sqlite.exec(`INSERT INTO address_book_entries (entry_id, subject_reference, address, label, created_at, available_at)
      VALUES ('e1', 'alice', '0x3333333333333333333333333333333333333333', 'Bob', 't', '2026-09-25T13:00:00.000Z')`);
    expect(await loadControls(db, "alice", "0x3333333333333333333333333333333333333333", now)).toEqual({
      accountLocked: false, enforceAddressBook: true, dailyLimitCents: 50000, spentCents: 10000, spentUnknown: false, recipient: "cooling" });
    expect((await loadControls(db, "alice", "0x4444444444444444444444444444444444444444", now)).recipient).toBe("unsaved");
  });
});

describe("submission and status", () => {
  it("binds one transaction hash to one action, once", async () => {
    const first = (await getAction(db, "alice", (await insertAction(db, action(), now))!))!;
    const second = (await getAction(db, "alice", (await insertAction(db, action(), now))!))!;
    expect(await recordSubmission(db, first, hash, now)).toBe("submitted");
    expect(await recordSubmission(db, (await getAction(db, "alice", first.id))!, hash, now)).toBe("already_submitted");
    expect(await recordSubmission(db, (await getAction(db, "alice", first.id))!, `0x${"b".repeat(64)}`, now)).toBe("not_submittable");
    expect(await recordSubmission(db, second, hash.toUpperCase().replace("0X", "0x"), now)).toBe("hash_in_use");
    expect(await getAction(db, "bob", first.id)).toBeNull();
  });

  it("expires unsigned actions but still accepts a late hash", async () => {
    const stored = (await getAction(db, "alice", (await insertAction(db, action(), now))!))!;
    const later = new Date(now.getTime() + 11 * 60_000);
    const expired = await expireIfStale(db, stored, later);
    expect(expired.status).toBe("expired");
    expect(await recordSubmission(db, expired, hash, later)).toBe("submitted");
  });

  it("moves status forward only and records each change", async () => {
    const stored = (await getAction(db, "alice", (await insertAction(db, action({ destinationChainId: 42161 }), now))!))!;
    await recordSubmission(db, stored, hash, now);
    let current = (await getAction(db, "alice", stored.id))!;
    current = await applyVerification(db, current, { status: "pending", reason: "finality" }, now);
    expect(current.status).toBe("submitted");
    current = await applyVerification(db, current, { status: "settling", reason: "awaiting_delivery" }, now);
    current = await applyVerification(db, current, { status: "confirmed", destinationHash: `0x${"c".repeat(64)}` }, now);
    expect(await getAction(db, "alice", stored.id)).toMatchObject({ status: "confirmed", destinationTransactionHash: `0x${"c".repeat(64)}`, settledAt: now.toISOString() });
    expect(() => sqlite.exec(`UPDATE actions SET status = 'submitted' WHERE action_id = '${stored.id}'`)).toThrow(/forward/);
    expect(sqlite.prepare("SELECT event_type FROM action_events WHERE action_id = ? ORDER BY rowid").all(stored.id).map((row) => (row as { event_type: string }).event_type))
      .toEqual(["submitted", "source_final", "settling", "delivered", "confirmed"]);
  });

  it("records a route's milestones once: final on the source network, then delivered", async () => {
    const events = (id: string) => sqlite.prepare("SELECT event_type FROM action_events WHERE action_id = ? ORDER BY rowid").all(id)
      .map((row) => (row as { event_type: string }).event_type);
    const route = (await getAction(db, "alice", (await insertAction(db, action({ destinationChainId: 1 }), now))!))!;
    await recordSubmission(db, route, hash, now);
    let current = (await getAction(db, "alice", route.id))!;
    current = await applyVerification(db, current, { status: "settling", reason: "finality" }, now);
    expect(events(route.id)).toEqual(["submitted", "settling"]);
    current = await applyVerification(db, current, { status: "settling", reason: "awaiting_delivery" }, now);
    current = await applyVerification(db, current, { status: "settling", reason: "awaiting_delivery" }, now);
    expect(events(route.id)).toEqual(["submitted", "settling", "source_final"]);
    current = await applyVerification(db, current, { status: "settling", reason: "confirmations", destinationHash: `0x${"d".repeat(64)}` }, now);
    await applyVerification(db, current, { status: "confirmed", destinationHash: `0x${"d".repeat(64)}` }, now);
    expect(events(route.id)).toEqual(["submitted", "settling", "source_final", "delivered", "confirmed"]);

    // A send on Base has no milestones of its own.
    const transfer = (await getAction(db, "alice", (await insertAction(db, action({ callsFingerprint: "0xother" }), now))!))!;
    await recordSubmission(db, transfer, `0x${"b".repeat(64)}`, now);
    await applyVerification(db, (await getAction(db, "alice", transfer.id))!, { status: "confirmed" }, now);
    expect(events(transfer.id)).toEqual(["submitted", "confirmed"]);
  });

  it("keeps what the customer reviewed and signed immutable", async () => {
    const id = (await insertAction(db, action(), now))!;
    for (const column of ["calls_json = '[]'", "effects_json = '[{}]'", "wallet_address = '0x0000000000000000000000000000000000000000'", "usd_cents = 1"]) {
      expect(() => sqlite.exec(`UPDATE actions SET ${column} WHERE action_id = '${id}'`), column).toThrow();
    }
    expect(() => sqlite.exec(`DELETE FROM actions WHERE action_id = '${id}'`)).toThrow(/retained/);
    expect(() => sqlite.exec(`UPDATE actions SET status = 'confirmed' WHERE action_id = '${id}'`)).toThrow(/forward/);
  });
});
