import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const state = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.database; } } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: httpErrors.AuthenticationError,
  requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "session-a" }) }));

import { applyProviderEvent, type ProjectionDatabase } from "@aurel/provider-projections";
import { GET as cards } from "@/app/api/cards/route";
import { GET as readPreferences, PATCH as patchPreferences } from "@/app/api/preferences/route";
import { GET as rewards } from "@/app/api/rewards/route";
import { GET as securityPolicy } from "@/app/api/security/policy/route";

let sqlite: DatabaseSync;
const migrations = resolve(process.cwd(), "../../infra/d1/migrations");
function d1(database: DatabaseSync) {
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => database.prepare(sql).get(...values as never[]) ?? null,
    all: async () => ({ results: database.prepare(sql).all(...values as never[]) }),
    run: async () => ({ meta: { changes: Number(database.prepare(sql).run(...values as never[]).changes) } })
  });
  return { prepare: (sql: string) => statement(sql), batch: async (items: Array<{ run(): Promise<unknown> }>) => {
    database.exec("BEGIN");
    try { const results = []; for (const item of items) results.push(await item.run()); database.exec("COMMIT"); return results; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  } };
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(resolve(migrations, file), "utf8"));
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
    VALUES ('alice', 'alice', '2026-09-25T00:00:00.000Z', '2026-09-25T00:00:00.000Z')`);
  state.database = d1(sqlite);
});
afterEach(() => sqlite.close());

const get = (handler: (request: Request) => Promise<Response>, path: string) => handler(new Request(`https://aura.test${path}`));
const providerEvent = (type: string, data: Record<string, unknown>, provider = "rain") => applyProviderEvent(d1(sqlite) as unknown as ProjectionDatabase, {
  id: crypto.randomUUID(), provider, type, subjectReference: "alice", providerObjectId: "object-1", createdAt: "2026-09-25T10:00:00.000Z", data });

describe("card route", () => {
  beforeEach(async () => {
    await providerEvent("card.account.updated", { cardReference: "card-1", customerReference: "cust-1", status: "active",
      network: "visa", lastFour: "1234", dailyLimit: "2500" });
  });

  it("does not show a stored card while the card program is switched off", async () => {
    const response = await get(cards, "/api/cards");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "setup_required", card: null, controls: { freeze: "setup_required", terminate: "setup_required" } });
  });

  it("shows the issuer-reported card once the card program is on, without enabling controls", async () => {
    sqlite.exec("UPDATE feature_flags SET enabled = 1, audience = 'all' WHERE flag_key = 'payment_cards'");
    const body = await (await get(cards, "/api/cards")).json() as Record<string, unknown>;
    expect(body).toMatchObject({ state: "active", card: { status: "active", lastFour: "1234", network: "visa", dailyLimit: "2500", currency: "USD" },
      controls: { freeze: "setup_required" }, source: { provider: "rain", observedAt: "2026-09-25T10:00:00.000Z" } });
  });
});

describe("rewards route", () => {
  it("reports not connected when no provider has reported anything", async () => {
    expect(await (await get(rewards, "/api/rewards")).json()).toMatchObject({ state: "not_connected", membership: null, entitlements: [] });
  });

  it("returns the current membership and entitlements", async () => {
    await providerEvent("membership.updated", { tier: "plus", score: 10, renewalAt: "2027-01-01T00:00:00.000Z" });
    const now = Date.now();
    await providerEvent("benefit.entitlement.updated", { entitlementId: "ent-1", benefitKey: "atm.fee_refund", status: "active", allowance: 5,
      periodStart: new Date(now - 86_400_000).toISOString(), periodEnd: new Date(now + 86_400_000).toISOString() });
    expect(await (await get(rewards, "/api/rewards")).json()).toMatchObject({ state: "observed", membership: { tier: "plus" },
      entitlements: [{ benefitKey: "atm.fee_refund", allowance: 5, consumed: 0 }] });
  });
});

describe("preferences route", () => {
  it("returns defaults, saves a partial update, and rejects unknown fields", async () => {
    expect(await (await get(readPreferences, "/api/preferences")).json()).toMatchObject({ preferences: { notifications: { transactionEmail: true } } });
    const saved = await patchPreferences(new Request("https://aura.test/api/preferences", { method: "PATCH",
      body: JSON.stringify({ notifications: { transactionPush: false } }) }));
    expect(saved.status).toBe(200);
    expect(await (await get(readPreferences, "/api/preferences")).json()).toMatchObject({
      preferences: { notifications: { transactionEmail: true, transactionPush: false } } });
    const invalid = await patchPreferences(new Request("https://aura.test/api/preferences", { method: "PATCH",
      body: JSON.stringify({ notifications: { productUpdatesEmail: true } }) }));
    expect(invalid.status).toBe(400);
  });
});

describe("security policy route", () => {
  it("includes signer-enforced wallet policies reported by the wallet provider", async () => {
    await providerEvent("wallet.policy.updated", { policyId: "pol-1", policyType: "destination_allowlist",
      configuration: { addresses: 2 }, enabled: true }, "privy");
    const body = await (await get(securityPolicy, "/api/security/policy")).json() as { policy: unknown; walletPolicies: unknown[] };
    expect(body.policy).toBeTruthy();
    expect(body.walletPolicies).toEqual([expect.objectContaining({ policyType: "destination_allowlist", enabled: true })]);
  });
});
