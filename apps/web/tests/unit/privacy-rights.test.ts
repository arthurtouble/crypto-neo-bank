import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const state = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.database; } } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: httpErrors.AuthenticationError,
  requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "session-a" }) }));
vi.mock("@/lib/auth/admin", () => ({ requireOperationsAdmin: async () => ({ subjectReference: "operator-1" }) }));

import { GET as consentState, POST as changeConsent } from "@/app/api/privacy/consent/route";
import { GET as myRequests, POST as requestData } from "@/app/api/privacy/data-requests/route";
import { PATCH as fulfil } from "@/app/api/ops/privacy/data-requests/[requestId]/route";
import { GET as termsState, POST as acceptTerms } from "@/app/api/terms/route";
import { legalDocuments } from "@/lib/legal/documents";
import { hasConsent } from "@/lib/privacy/consent-state";
import { subjectDataInventory } from "@/lib/privacy/subject-data";

const migrations = resolve(process.cwd(), "../../infra/d1/migrations");
let sqlite: DatabaseSync;

/** D1-shaped wrapper: batch() runs in one transaction and returns results for SELECTs, changes for writes. */
function d1(database: DatabaseSync) {
  const statement = (sql: string, values: unknown[] = []) => ({
    sql,
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => database.prepare(sql).get(...values as never[]) ?? null,
    all: async () => ({ results: database.prepare(sql).all(...values as never[]), meta: { changes: 0 } }),
    run: async () => ({ results: [], meta: { changes: Number(database.prepare(sql).run(...values as never[]).changes) } })
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (items: Array<ReturnType<typeof statement>>) => {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const item of items) results.push(/^\s*select/i.test(item.sql) ? await item.all() : await item.run());
        database.exec("COMMIT");
        return results;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    }
  };
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(resolve(migrations, file), "utf8"));
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', '2026-09-25T00:00:00Z', '2026-09-25T00:00:00Z');
    INSERT INTO security_profiles (subject_reference, updated_at) VALUES ('alice', '2026-09-25T00:00:00Z');`);
  state.database = d1(sqlite);
});
afterEach(() => sqlite.close());

const post = (handler: (request: Request) => Promise<Response>, body: unknown) => handler(new Request("https://aura.test/api", { method: "POST", body: JSON.stringify(body) }));
const get = (handler: (request: Request) => Promise<Response>) => handler(new Request("https://aura.test/api"));
const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE subject_reference = 'alice'`).get() as { n: number }).n;

describe("consent", () => {
  it("is off until granted, and a later withdrawal turns it off", async () => {
    expect(await (await get(consentState)).json()).toMatchObject({ consent: { marketing: false } });
    expect((await post(changeConsent, { purpose: "marketing", action: "granted", noticeVersion: "2026-09-25" })).status).toBe(200);
    expect(await (await get(consentState)).json()).toMatchObject({ consent: { marketing: true, serviceUpdates: false } });
    await post(changeConsent, { purpose: "marketing", action: "withdrawn", noticeVersion: "2026-09-25" });
    expect(await hasConsent(state.database as D1Database, "alice", "marketing")).toBe(false);
  });

  it("records withdrawal even when the audit write fails", async () => {
    sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    expect((await post(changeConsent, { purpose: "marketing", action: "withdrawn", noticeVersion: "2026-09-25" })).status).toBe(200);
    expect(count("consent_events")).toBe(1);
  });

  it("prefers withdrawal if grant and withdrawal share a timestamp", async () => {
    sqlite.exec(`INSERT INTO consent_events VALUES ('g','alice','marketing','granted','v','2026-09-24T05:00:00Z');
      INSERT INTO consent_events VALUES ('w','alice','marketing','withdrawn','v','2026-09-24T05:00:00Z');`);
    expect(await hasConsent(state.database as D1Database, "alice", "marketing")).toBe(false);
  });

  it("rejects the retired beta purpose", async () => {
    expect((await post(changeConsent, { purpose: "beta_operational", action: "withdrawn", noticeVersion: "v" })).status).toBe(400);
  });
});

describe("data-rights requests", () => {
  const seed = () => sqlite.exec(`
    INSERT INTO user_preferences VALUES ('alice', '{}', '2026-09-25T00:00:00Z');
    INSERT INTO product_events (event_id, subject_reference, session_reference, event_name, surface, properties_json, occurred_at)
      VALUES ('e1', 'alice', 's', 'activation_viewed', '/app', '{}', '2026-09-25T00:00:00Z');
    INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      VALUES ('a1', 'alice', 'customer', 'alice', 'x', 'y', 'z', '{}', '2026-09-25T00:00:00Z');
    INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint, effects_json,
      counts_toward_limit, status, created_at, expires_at, updated_at)
      VALUES ('act1', 'alice', '0x1111111111111111111111111111111111111111', 'transfer', 8453, '{}', '[{"to":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","value":"0","data":"0x"}]', 'fp', '[]', 1, 'prepared', 't', 't', 't');
    INSERT INTO action_events (event_id, action_id, event_type, evidence_json, occurred_at) VALUES ('ev1', 'act1', 'prepared', '{}', 't');`);
  const open = async (requestType: "export" | "delete") => (await (await post(requestData, { requestType })).json() as { requestId: string }).requestId;
  const act = (id: string, action: string) => fulfil(new Request("https://aura.test", { method: "PATCH", body: JSON.stringify({ action }) }),
    { params: Promise.resolve({ requestId: id }) });

  it("lets a customer see their own requests", async () => {
    await open("export");
    expect(await (await get(myRequests)).json()).toMatchObject({ requests: [{ request_type: "export", status: "received" }] });
  });

  it("exports every exportable table with its retention reason", async () => {
    seed();
    const body = await (await act(await open("export"), "export")).json() as { export: Record<string, { rows: unknown[]; reason: string }> };
    expect(body.export.user_preferences.rows).toHaveLength(1);
    expect(body.export.audit_events.rows.length).toBeGreaterThan(0);
    expect(body.export.audit_events.reason).toMatch(/audit/i);
    expect(body.export).not.toHaveProperty("action_passkey_challenges");
    // A transaction's status history comes with it, although its table has no customer column.
    expect(body.export.action_events.rows).toHaveLength(1);
  });

  it("erases erasable data, keeps evidence, and cannot be fulfilled twice", async () => {
    seed();
    const id = await open("delete");
    const response = await act(id, "delete");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ erasure: { erased: { user_preferences: 1, product_events: 1 } } });
    expect(count("user_preferences")).toBe(0);
    expect(count("product_events")).toBe(0);
    expect(count("audit_events")).toBeGreaterThan(0);
    expect(count("security_profiles")).toBe(1);
    expect((await act(id, "delete")).status).toBe(409);
  });

  it("refuses an action that does not match the request", async () => {
    expect((await act(await open("export"), "delete")).status).toBe(409);
  });

  it("classifies every table that holds customer data", () => {
    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
      .filter((table) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = 'subject_reference'`).get() as { n: number }).n > 0);
    expect(tables.filter((table) => !(table in subjectDataInventory)).sort()).toEqual([]);
    expect(Object.keys(subjectDataInventory).filter((table) => !tables.includes(table))).toEqual([]);
  });
});

describe("terms acceptance", () => {
  const versions = { termsVersion: legalDocuments.terms.version, privacyVersion: legalDocuments.privacy.version };

  it("is required until the current versions are accepted, and is recorded once", async () => {
    expect(await (await get(termsState)).json()).toMatchObject({ accepted: false });
    expect((await post(acceptTerms, versions)).status).toBe(200);
    expect((await post(acceptTerms, versions)).status).toBe(200);
    expect(await (await get(termsState)).json()).toMatchObject({ accepted: true });
    expect(count("consent_evidence")).toBe(2);
  });

  it("refuses acceptance of a version the customer was not shown", async () => {
    const response = await post(acceptTerms, { ...versions, termsVersion: "2020-01-01" });
    expect(response.status).toBe(409);
    expect(count("consent_evidence")).toBe(0);
  });
});
