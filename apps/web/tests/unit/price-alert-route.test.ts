import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state = vi.hoisted(() => ({ database: null as D1Database | null, subject: "alice" as string | null, beta: true, mode: "invite" as "invite" | "preview", feature: true, catalogEligible: true, country: "PT", rate: true }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.database; } } }));
vi.mock("@/lib/auth/server", () => {
  class AuthenticationError extends Error {}
  return { AuthenticationError, requireVerifiedSubject: async () => {
    if (!state.subject) throw new AuthenticationError();
    return { subjectReference: state.subject, sessionReference: "session", expiresAt: Date.now() + 60_000 };
  } };
});
vi.mock("@/lib/beta/access", () => {
  class BetaAccessError extends Error { constructor(readonly code: string) { super(code); } }
  return { BetaAccessError, configuredCountries: () => ["PT"], requireBetaAccess: async () => {
    if (!state.beta) throw new BetaAccessError("invite_required");
    return { mode: state.mode, countryCode: state.country };
  } };
});
vi.mock("@/lib/features/flags", () => {
  class FeatureUnavailableError extends Error {}
  return { FeatureUnavailableError, requireFeature: async () => { if (!state.feature) throw new FeatureUnavailableError(); } };
});
vi.mock("@/lib/swap/catalog", () => ({ resolveCatalogAsset: async (id: string) => state.catalogEligible ? { id, verification: "verified", eligibility: "eligible" } : null }));
vi.mock("@/lib/security/rate-limit", () => {
  class RateLimitError extends Error { retryAfterSeconds = 60; }
  return { RateLimitError, enforceRateLimit: async () => { if (!state.rate) throw new RateLimitError(); } };
});
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));

import { GET, PATCH, POST } from "@/app/api/swap/alerts/route";

function d1(db: DatabaseSync): D1Database {
  return { prepare(sql: string) { return { bind(...args: unknown[]) {
    const statement = db.prepare(sql), values = args as Array<string | number | null>;
    return { async first() { return statement.get(...values) ?? null; }, async all() { return { results: statement.all(...values) }; }, async run() { const info = statement.run(...values); return { meta: { changes: Number(info.changes) } }; } };
  } }; }, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    db.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
}

const post = (body: unknown) => POST(new Request("https://aurel.test/api/swap/alerts", { method: "POST", body: JSON.stringify(body) }));
const patch = (body: unknown) => PATCH(new Request("https://aurel.test/api/swap/alerts", { method: "PATCH", body: JSON.stringify(body) }));
const input = () => ({ pairId: "ETH/USD", direction: "above", threshold: "3500.5" });
let sqlite: DatabaseSync;
beforeEach(() => {
  Object.assign(state, { subject: "alice", beta: true, mode: "invite", feature: true, catalogEligible: true, country: "PT", rate: true });
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE subject_profiles(subject_reference TEXT PRIMARY KEY); CREATE TABLE security_profiles(subject_reference TEXT PRIMARY KEY, account_locked INTEGER NOT NULL); CREATE TABLE beta_access(subject_reference TEXT PRIMARY KEY,status TEXT NOT NULL,country_code TEXT NOT NULL); CREATE TABLE feature_flags(flag_key TEXT PRIMARY KEY,enabled INTEGER NOT NULL); CREATE TABLE audit_events(audit_id TEXT PRIMARY KEY,subject_reference TEXT,actor_type TEXT NOT NULL,actor_reference TEXT NOT NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_reference TEXT,evidence_json TEXT NOT NULL,occurred_at TEXT NOT NULL); INSERT INTO subject_profiles VALUES ('alice'),('bob'); INSERT INTO security_profiles VALUES ('alice',0),('bob',0); INSERT INTO beta_access VALUES ('alice','active','PT'),('bob','active','PT'); INSERT INTO feature_flags VALUES ('swaps',1);");
  sqlite.exec(readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0022_price_alerts_swap_reminders.sql"), "utf8"));
  state.database = d1(sqlite);
});
afterEach(() => { state.database = null; sqlite.close(); });

describe("customer price alert API", () => {
  it("keeps a reviewed alert subject-bound and non-executable", async () => {
    const created = await post(input());
    expect(created.status).toBe(201);
    const body = await created.json() as { alert: { alertId: string; thresholdVersion: number; mappingVersion: string }; execution: string };
    expect(body.alert).toMatchObject({ thresholdVersion: 1, mappingVersion: "kraken-posttrade-eth-usd-v1" });
    expect(body.execution).toBe("customer_review_required");
    expect(body).not.toHaveProperty("transactionHash");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='swap.alert.created'").get()).toMatchObject({ count: 1 });
    expect((await (await GET(new Request("https://aurel.test/api/swap/alerts"))).json() as { alerts: unknown[] }).alerts).toHaveLength(1);
    state.subject = "bob";
    expect((await (await GET(new Request("https://aurel.test/api/swap/alerts"))).json() as { alerts: unknown[] }).alerts).toEqual([]);
    expect((await patch({ alertId: body.alert.alertId, version: 1, action: "cancel" })).status).toBe(404);
  });

  it("rejects unknown pairs, fake authority and invalid decimal thresholds", async () => {
    expect((await post({ ...input(), pairId: "BTC/USD" })).status).toBe(400);
    expect((await post({ ...input(), walletSignature: "fake" })).status).toBe(400);
    expect((await post({ ...input(), threshold: "0" })).status).toBe(400);
    expect((await post({ ...input(), threshold: "1e5" })).status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM price_alerts").get()).toMatchObject({ count: 0 });
  });

  it("requires identity, beta, country, feature, unlocked account and current asset eligibility to create", async () => {
    state.subject = null; expect((await post(input())).status).toBe(401);
    state.subject = "alice"; state.beta = false; expect((await post(input())).status).toBe(403);
    state.beta = true; state.country = "US"; expect((await post(input())).status).toBe(403);
    state.country = "PT"; state.feature = false; expect((await post(input())).status).toBe(503);
    state.feature = true; state.catalogEligible = false; expect((await post(input())).status).toBe(400);
    state.catalogEligible = true; sqlite.exec("UPDATE security_profiles SET account_locked=1 WHERE subject_reference='alice'"); expect((await post(input())).status).toBe(423);
  });

  it("uses CAS versions, supersedes old due occurrences, and allows pause or cancellation under a lock", async () => {
    const created = await post(input());
    const { alert } = await created.json() as { alert: { alertId: string } };
    sqlite.prepare("INSERT INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,alert_id,threshold_version,crossing_observation_id,observed_price_decimal,source_observed_at,created_at) VALUES ('due','alice','alert',?,1,'obs','3501','2026-09-23T10:00:00.123456Z','2026-09-23T10:00:00.123Z')").run(alert.alertId);
    expect((await patch({ alertId: alert.alertId, version: 1, action: "edit", threshold: "3600" })).status).toBe(200);
    expect(sqlite.prepare("SELECT threshold_version,threshold_decimal FROM price_alerts WHERE alert_id=?").get(alert.alertId)).toMatchObject({ threshold_version: 2, threshold_decimal: "3600" });
    expect(sqlite.prepare("SELECT reminder_state FROM swap_reminder_occurrences WHERE occurrence_id='due'").get()).toMatchObject({ reminder_state: "superseded" });
    expect((await patch({ alertId: alert.alertId, version: 1, action: "pause" })).status).toBe(409);
    sqlite.exec("UPDATE security_profiles SET account_locked=1 WHERE subject_reference='alice'");
    expect((await patch({ alertId: alert.alertId, version: 2, action: "pause" })).status).toBe(200);
    expect((await patch({ alertId: alert.alertId, version: 3, action: "resume" })).status).toBe(423);
    expect((await patch({ alertId: alert.alertId, version: 3, action: "cancel" })).status).toBe(200);
    expect((await patch({ alertId: alert.alertId, version: 4, action: "resume" })).status).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action LIKE 'swap.alert.%'").get()).toMatchObject({ count: 4 });
  });

  it("rolls back alert creation and versioned changes when audit persistence fails", async () => {
    sqlite.exec("CREATE TRIGGER reject_alert_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    expect((await post(input())).status).toBe(503);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM price_alerts").get()).toMatchObject({ count: 0 });
    sqlite.exec("DROP TRIGGER reject_alert_audit");
    const { alert } = await (await post(input())).json() as { alert: { alertId: string } };
    sqlite.exec("CREATE TRIGGER reject_alert_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    expect((await patch({ alertId: alert.alertId, version: 1, action: "pause" })).status).toBe(503);
    expect(sqlite.prepare("SELECT status,threshold_version FROM price_alerts WHERE alert_id=?").get(alert.alertId)).toMatchObject({ status: "active", threshold_version: 1 });
  });

  it("does not save a new alert when the account locks after eligibility review", async () => {
    const database = state.database!;
    state.database = { ...database, async batch(statements) {
      sqlite.exec("UPDATE security_profiles SET account_locked=1 WHERE subject_reference='alice'");
      return database.batch(statements);
    } } as D1Database;
    expect((await post(input())).status).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM price_alerts").get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get()).toMatchObject({ count: 0 });
  });

  it("does not save an alert if beta status, country or Swap feature changes before the write", async () => {
    const database = state.database!;
    for (const [change, restore] of [
      ["UPDATE beta_access SET status='suspended' WHERE subject_reference='alice'", "UPDATE beta_access SET status='active' WHERE subject_reference='alice'"],
      ["UPDATE beta_access SET country_code='US' WHERE subject_reference='alice'", "UPDATE beta_access SET country_code='PT' WHERE subject_reference='alice'"],
      ["UPDATE feature_flags SET enabled=0 WHERE flag_key='swaps'", "UPDATE feature_flags SET enabled=1 WHERE flag_key='swaps'"]
    ]) {
      state.database = { ...database, async batch(statements) { sqlite.exec(change); return database.batch(statements); } } as D1Database;
      expect((await post(input())).status).toBe(409);
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM price_alerts").get()).toMatchObject({ count: 0 });
      sqlite.exec(restore);
    }
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get()).toMatchObject({ count: 0 });
  });

  it("keeps preview-mode alerts independent of invite records while still requiring the feature flag", async () => {
    state.mode = "preview";
    sqlite.exec("DELETE FROM beta_access WHERE subject_reference='alice'");
    expect((await post(input())).status).toBe(201);
    sqlite.exec("UPDATE feature_flags SET enabled=0 WHERE flag_key='swaps'");
    expect((await post(input())).status).toBe(409);
  });

  it("does not resume when beta access or the feature is removed after eligibility review", async () => {
    const { alert } = await (await post(input())).json() as { alert: { alertId: string } };
    expect((await patch({ alertId: alert.alertId, version: 1, action: "pause" })).status).toBe(200);
    const database = state.database!;
    state.database = { ...database, async batch(statements) {
      sqlite.exec("UPDATE feature_flags SET enabled=0 WHERE flag_key='swaps'");
      return database.batch(statements);
    } } as D1Database;
    expect((await patch({ alertId: alert.alertId, version: 2, action: "resume" })).status).toBe(409);
    expect(sqlite.prepare("SELECT status,threshold_version FROM price_alerts WHERE alert_id=?").get(alert.alertId)).toMatchObject({ status: "paused", threshold_version: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='swap.alert.resume'").get()).toMatchObject({ count: 0 });
  });

  it("records complete before and after customer instructions without signing data", async () => {
    const { alert } = await (await post({ ...input(), hysteresisBps: 250, cooldownSeconds: 7200 })).json() as { alert: { alertId: string } };
    const creation = sqlite.prepare("SELECT evidence_json FROM audit_events WHERE action='swap.alert.created'").get() as { evidence_json: string };
    expect(JSON.parse(creation.evidence_json)).toMatchObject({ before: null, after: {
      pairId: "ETH/USD", baseAssetId: "8453:native", quoteAssetId: "iso4217:USD", mappingVersion: "kraken-posttrade-eth-usd-v1",
      direction: "above", threshold: "3500.5", hysteresisBps: 250, cooldownSeconds: 7200, status: "active", version: 1
    } });
    expect((await patch({ alertId: alert.alertId, version: 1, action: "edit", direction: "below", threshold: "3200" })).status).toBe(200);
    const edit = sqlite.prepare("SELECT evidence_json FROM audit_events WHERE action='swap.alert.edit'").get() as { evidence_json: string };
    expect(JSON.parse(edit.evidence_json)).toMatchObject({ before: { direction: "above", threshold: "3500.5", status: "active", version: 1 },
      after: { direction: "below", threshold: "3200", hysteresisBps: 250, cooldownSeconds: 7200, status: "active", version: 2 } });
    expect(edit.evidence_json).not.toContain("walletSignature");
  });
});
