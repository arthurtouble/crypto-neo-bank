import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state = vi.hoisted(() => ({ database: null as D1Database | null, subject: "alice" as string | null, beta: true, feature: true, crossChain: true, catalogEligible: true, country: "PT", rate: true }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.database; } } }));
vi.mock("@/lib/auth/server", () => {
  class AuthenticationError extends Error {}
  return { AuthenticationError, requireVerifiedSubject: async () => {
    if (!state.subject) throw new AuthenticationError("Unauthenticated");
    return { subjectReference: state.subject, sessionReference: "session", expiresAt: Date.now() + 60_000 };
  } };
});
vi.mock("@/lib/beta/access", () => {
  class BetaAccessError extends Error { constructor(readonly code: string) { super(code); } }
  return { BetaAccessError, configuredCountries: () => ["PT"], requireBetaAccess: async () => {
    if (!state.beta) throw new BetaAccessError("invite_required");
    return { countryCode: state.country };
  } };
});
vi.mock("@/lib/features/flags", () => {
  class FeatureUnavailableError extends Error {}
  return { FeatureUnavailableError, requireFeature: async () => { if (!state.feature) throw new FeatureUnavailableError(); }, featureEnabled: async (_db: D1Database, key: string) => key === "cross_chain" ? state.crossChain : state.feature };
});
vi.mock("@/lib/swap/catalog", () => ({ resolveCatalogAsset: async (id: string) => state.catalogEligible ? { id, verification: "verified", eligibility: "eligible" } : null }));
vi.mock("@/lib/security/rate-limit", () => {
  class RateLimitError extends Error { retryAfterSeconds = 60; }
  return { RateLimitError, enforceRateLimit: async () => { if (!state.rate) throw new RateLimitError(); } };
});
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));
vi.mock("@/lib/security/audit", () => ({ writeAuditEvent: async () => undefined }));

import { GET, PATCH, POST } from "@/app/api/swap/reminders/route";
import { GET as dueGET } from "@/app/api/swap/reminders/due/route";

function d1(db: DatabaseSync): D1Database {
  return { prepare(sql: string) { return { bind(...args: unknown[]) {
    const statement = db.prepare(sql), values = args as Array<string | number | null>;
    return { async first() { return statement.get(...values) ?? null; }, async all() { return { results: statement.all(...values) }; }, async run() { const info = statement.run(...values); return { meta: { changes: Number(info.changes) } }; } };
  } }; }, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    db.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
}

const fromAssetId = "8453:native", toAssetId = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const future = () => new Date(Date.now() + 20 * 60_000).toISOString().slice(0, 16);
const post = (body: unknown) => POST(new Request("https://aurel.test/api/swap/reminders", { method: "POST", body: JSON.stringify(body) }));
const patch = (body: unknown) => PATCH(new Request("https://aurel.test/api/swap/reminders", { method: "PATCH", body: JSON.stringify(body) }));
const input = () => ({ fromAssetId, toAssetId, amount: "0.1", scheduleType: "weekly", timeZone: "UTC", anchorLocal: future() });
let sqlite: DatabaseSync;
beforeEach(() => {
  Object.assign(state, { subject: "alice", beta: true, feature: true, crossChain: true, catalogEligible: true, country: "PT", rate: true });
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE subject_profiles(subject_reference TEXT PRIMARY KEY); CREATE TABLE security_profiles(subject_reference TEXT PRIMARY KEY, account_locked INTEGER NOT NULL); CREATE TABLE audit_events(audit_id TEXT PRIMARY KEY,subject_reference TEXT,actor_type TEXT NOT NULL,actor_reference TEXT NOT NULL,action TEXT NOT NULL,target_type TEXT,target_reference TEXT,evidence_json TEXT NOT NULL,occurred_at TEXT NOT NULL); INSERT INTO subject_profiles VALUES ('alice'),('bob'); INSERT INTO security_profiles VALUES ('alice',0),('bob',0);");
  sqlite.exec(readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0022_price_alerts_swap_reminders.sql"), "utf8"));
  state.database = d1(sqlite);
});
afterEach(() => { state.database = null; sqlite.close(); });

describe("authenticated Swap reminder API", () => {
  it("requires authentication, beta, allowed country, feature and unlocked account", async () => {
    state.subject = null; expect((await post(input())).status).toBe(401);
    state.subject = "alice"; state.beta = false; expect((await post(input())).status).toBe(403);
    state.beta = true; state.country = "US"; expect((await post(input())).status).toBe(403);
    state.country = "PT"; state.feature = false; expect((await post(input())).status).toBe(503);
    state.feature = true; sqlite.exec("UPDATE security_profiles SET account_locked=1 WHERE subject_reference='alice'"); expect((await post(input())).status).toBe(423);
  });
  it("saves only reviewed canonical assets, rejects client authority, and lists only the subject's plans", async () => {
    expect((await post({ ...input(), fromAssetId: "1:0x0000000000000000000000000000000000000001" })).status).toBe(400);
    expect((await post({ ...input(), walletSignature: "fake" })).status).toBe(400);
    const created = await post(input());
    expect(created.status).toBe(201);
    const plan = (await created.json() as { plan: { planId: string } }).plan;
    expect(plan.planId).toBeTruthy();
    expect((await (await GET(new Request("https://aurel.test/api/swap/reminders"))).json() as { plans: unknown[] }).plans).toHaveLength(1);
    state.subject = "bob";
    expect((await (await GET(new Request("https://aurel.test/api/swap/reminders"))).json() as { plans: unknown[] }).plans).toEqual([]);
    expect((await patch({ planId: plan.planId, version: 1, action: "cancel" })).status).toBe(404);
  });
  it("uses versions for edits and pause, and returns review-only due items", async () => {
    const created = (await (await post(input())).json() as { plan: { planId: string } }).plan;
    expect((await patch({ planId: created.planId, version: 1, action: "pause" })).status).toBe(200);
    expect((await patch({ planId: created.planId, version: 1, action: "cancel" })).status).toBe(409);
    expect((await patch({ planId: created.planId, version: 2, action: "resume" })).status).toBe(200);
    const dueAt = new Date(Date.now() - 60_000).toISOString().slice(0, 16);
    sqlite.prepare("UPDATE swap_reminder_plans SET schedule_type='one_time', anchor_local=?, next_due_at=? WHERE plan_id=?").run(dueAt, `${dueAt}:00.000Z`, created.planId);
    const response = await dueGET(new Request("https://aurel.test/api/swap/reminders/due"));
    expect(response.status).toBe(200);
    const body = await response.json() as { occurrences: Array<Record<string, unknown>>; execution: string };
    expect(body.occurrences).toHaveLength(1);
    expect(body.occurrences[0]).toMatchObject({ canReview: true, disabledReason: null });
    expect(body.occurrences[0]).not.toHaveProperty("transactionHash");
    expect(body.occurrences[0]).not.toHaveProperty("quoteId");
    expect(body.execution).toBe("customer_review_required");
  });
  it("rejects an edit that changes only one asset to the saved other asset", async () => {
    const created = (await (await post(input())).json() as { plan: { planId: string } }).plan;
    expect((await patch({ planId: created.planId, version: 1, action: "edit", fromAssetId: toAssetId })).status).toBe(400);
  });
  it("disables only an ineligible due occurrence when cross-chain or catalog review is unavailable", async () => {
    const created = (await (await post({ ...input(), toAssetId: "1:native" })).json() as { plan: { planId: string } }).plan;
    const dueAt = new Date(Date.now() - 60_000).toISOString().slice(0, 16);
    sqlite.prepare("UPDATE swap_reminder_plans SET schedule_type='one_time', anchor_local=?, next_due_at=? WHERE plan_id=?").run(dueAt, `${dueAt}:00.000Z`, created.planId);
    state.crossChain = false;
    const disabledByRoute = await (await dueGET(new Request("https://aurel.test/api/swap/reminders/due"))).json() as { occurrences: Array<{ canReview: boolean; disabledReason: string }> };
    expect(disabledByRoute.occurrences[0]).toMatchObject({ canReview: false, disabledReason: "cross_chain_unavailable" });
    state.crossChain = true; state.catalogEligible = false;
    const disabledByCatalog = await (await dueGET(new Request("https://aurel.test/api/swap/reminders/due"))).json() as { occurrences: Array<{ canReview: boolean; disabledReason: string }> };
    expect(disabledByCatalog.occurrences[0]).toMatchObject({ canReview: false, disabledReason: "asset_unavailable" });
    state.catalogEligible = true;
    sqlite.exec("UPDATE security_profiles SET account_locked=1 WHERE subject_reference='alice'");
    const disabledByLock = await (await dueGET(new Request("https://aurel.test/api/swap/reminders/due"))).json() as { occurrences: Array<{ canReview: boolean; disabledReason: string }> };
    expect(disabledByLock.occurrences[0]).toMatchObject({ canReview: false, disabledReason: "account_locked" });
  });
});
