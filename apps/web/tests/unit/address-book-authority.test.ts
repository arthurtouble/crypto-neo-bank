import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";

const state = vi.hoisted(() => ({ database: null as D1Database | null }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.database; } } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class extends Error {}, requireVerifiedSubject: async () => ({
  subjectReference: "alice", sessionReference: "session-alice"
}) }));
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: async () => undefined }));

import { DELETE as deleteAddress, POST as saveAddress } from "@/app/api/security/addresses/route";
import { POST as saveRecipient } from "@/app/api/recipients/route";

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
const securityRequest = (label = "Home") => saveAddress(new Request("https://aurel.test/api/security/addresses", {
  method: "POST", body: JSON.stringify({ address, label })
}));
const recipientRequest = (name = "Home") => saveRecipient(new Request("https://aurel.test/api/recipients", {
  method: "POST", body: JSON.stringify({ kind: "wallet", address, name })
}));

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE security_profiles (subject_reference TEXT PRIMARY KEY, new_address_delay_seconds INTEGER NOT NULL,
      enforce_address_book INTEGER NOT NULL, account_locked INTEGER NOT NULL);
    CREATE TABLE address_book_entries (entry_id TEXT PRIMARY KEY, subject_reference TEXT NOT NULL,
      chain_family TEXT NOT NULL, address TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL,
      available_at TEXT NOT NULL, last_used_at TEXT, UNIQUE(subject_reference,chain_family,address));
    CREATE TABLE audit_events (audit_id TEXT PRIMARY KEY, subject_reference TEXT, actor_type TEXT NOT NULL,
      actor_reference TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_reference TEXT,
      evidence_json TEXT NOT NULL, occurred_at TEXT NOT NULL);
    INSERT INTO security_profiles VALUES ('alice',86400,0,0);`);
  state.database = d1(sqlite);
});
afterEach(() => { state.database = null; sqlite.close(); });

describe("saved wallet address authority", () => {
  it("returns the existing ID and cooling time when renaming through Security", async () => {
    const first = (await (await securityRequest()).json() as { entry: { entryId: string; availableAt: string } }).entry;
    const second = await securityRequest("New name");
    expect(second.status).toBe(201);
    expect((await second.json() as { entry: { entryId: string; availableAt: string; label: string } }).entry)
      .toMatchObject({ entryId: first.entryId, availableAt: first.availableAt, label: "New name" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM address_book_entries").get()).toMatchObject({ count: 1 });
  });

  it("rolls back a new Security address when the required audit write fails", async () => {
    sqlite.exec("CREATE TRIGGER reject_address_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    expect((await securityRequest()).status).toBe(503);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM address_book_entries").get()).toMatchObject({ count: 0 });
  });

  it("rolls back a new Recipients address when the required audit write fails", async () => {
    sqlite.exec("CREATE TRIGGER reject_address_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    expect((await recipientRequest()).status).toBe(503);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM address_book_entries").get()).toMatchObject({ count: 0 });
  });

  it("requires unavailable step-up before adding a new enforced allowlist destination", async () => {
    sqlite.exec("UPDATE security_profiles SET enforce_address_book=1 WHERE subject_reference='alice'");
    expect((await securityRequest()).status).toBe(409);
    expect((await recipientRequest()).status).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM address_book_entries").get()).toMatchObject({ count: 0 });
  });

  it("restores a deleted destination if its audit write fails", async () => {
    const first = (await (await securityRequest()).json() as { entry: { entryId: string } }).entry;
    sqlite.exec("CREATE TRIGGER reject_address_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    const response = await deleteAddress(new Request(`https://aurel.test/api/security/addresses?entryId=${first.entryId}`, { method: "DELETE" }));
    expect(response.status).toBe(503);
    expect(sqlite.prepare("SELECT entry_id FROM address_book_entries WHERE entry_id=?").get(first.entryId)).toMatchObject({ entry_id: first.entryId });
  });
});
