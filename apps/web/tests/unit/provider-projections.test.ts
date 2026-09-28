import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyProviderEvent, claimProviderCommand, readCurrentCardAccount, readCurrentEntitlements, readMembership, readPreferences,
  settleProviderCommand, updatePreferences, type ProjectionDatabase, type ProviderEvent
} from "@aurel/provider-projections";

const migrations = resolve(process.cwd(), "../../infra/d1/migrations");
let sqlite: DatabaseSync;
let db: ProjectionDatabase;

/** A D1-shaped wrapper over node:sqlite, with batch() as one transaction. */
function d1(database: DatabaseSync): ProjectionDatabase {
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => (database.prepare(sql).get(...values as never[]) ?? null) as T | null,
    all: async <T>() => ({ results: database.prepare(sql).all(...values as never[]) as T[] }),
    run: async () => ({ meta: { changes: Number(database.prepare(sql).run(...values as never[]).changes) } })
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      database.exec("BEGIN");
      try { const results = []; for (const item of statements) results.push(await item.run()); database.exec("COMMIT"); return results; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    }
  };
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(resolve(migrations, file), "utf8"));
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
    VALUES ('alice', 'alice', '2026-09-25T00:00:00.000Z', '2026-09-25T00:00:00.000Z')`);
  db = d1(sqlite);
});
afterEach(() => sqlite.close());

const event = (type: string, data: Record<string, unknown>, overrides: Partial<ProviderEvent> = {}): ProviderEvent => ({
  id: crypto.randomUUID(), provider: "bridge", type, subjectReference: "alice", providerObjectId: "object-1",
  createdAt: "2026-09-25T10:00:00.000Z", data, ...overrides
});
const card = { cardReference: "card-1", customerReference: "cust-1", status: "active", formFactor: "virtual", network: "visa",
  lastFour: "4242", dailyLimit: "2500.00", monthlyLimit: "10000", currency: "USD" };

describe("provider event dispatch", () => {
  it("ignores events without a projection, from the wrong provider, or without a subject", async () => {
    expect(await applyProviderEvent(db, event("account.updated", {}))).toMatchObject({ status: "ignored", reason: "unsupported_event" });
    expect(await applyProviderEvent(db, event("wallet.policy.updated", {}, { provider: "bridge" }))).toMatchObject({ reason: "unsupported_event" });
    expect(await applyProviderEvent(db, event("card.account.updated", card, { subjectReference: undefined }))).toMatchObject({ reason: "missing_subject" });
  });

  it("ignores unknown customers and invalid payloads instead of failing the queue", async () => {
    expect(await applyProviderEvent(db, event("card.account.updated", card, { subjectReference: "mallory" }))).toMatchObject({ reason: "unknown_subject" });
    expect(await applyProviderEvent(db, event("card.account.updated", { ...card, lastFour: "42" }))).toMatchObject({ reason: "invalid_payload" });
    expect(await applyProviderEvent(db, event("card.account.updated", { ...card, pan: "4242424242424242" }))).toMatchObject({ reason: "invalid_payload" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM card_account_projections").get()).toMatchObject({ n: 0 });
  });
});

describe("card account projection", () => {
  it("stores the issuer-reported card and reads it back", async () => {
    expect(await applyProviderEvent(db, event("card.account.updated", card))).toEqual({ status: "applied", projection: "card_account_projections" });
    expect(await readCurrentCardAccount(db, "alice")).toMatchObject({ cardReference: "card-1", status: "active", lastFour: "4242",
      network: "visa", dailyLimit: "2500.00", provider: "bridge", observedAt: "2026-09-25T10:00:00.000Z" });
  });

  it("never lets an older event overwrite a newer observation", async () => {
    await applyProviderEvent(db, event("card.account.updated", { ...card, status: "frozen" }, { createdAt: "2026-09-25T11:00:00.000Z" }));
    expect(await applyProviderEvent(db, event("card.account.updated", card))).toMatchObject({ status: "stale" });
    expect(await readCurrentCardAccount(db, "alice")).toMatchObject({ status: "frozen" });
  });

  it("does not move a card reference to another customer or provider", async () => {
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
      VALUES ('bob', 'bob', '2026-09-25T00:00:00.000Z', '2026-09-25T00:00:00.000Z')`);
    await applyProviderEvent(db, event("card.account.updated", card));
    const later = { createdAt: "2026-09-25T12:00:00.000Z" };
    expect(await applyProviderEvent(db, event("card.account.updated", card, { ...later, subjectReference: "bob" }))).toMatchObject({ status: "stale" });
    expect(await applyProviderEvent(db, event("card.account.updated", card, { ...later, provider: "rain" }))).toMatchObject({ status: "stale" });
    expect(await readCurrentCardAccount(db, "bob")).toBeNull();
  });

  it("does not present a closed card", async () => {
    await applyProviderEvent(db, event("card.account.updated", { ...card, status: "closed" }));
    expect(await readCurrentCardAccount(db, "alice")).toBeNull();
  });
});

describe("membership and benefit projections", () => {
  const membership = { tier: "plus", score: 420, qualification: { balanceDays: 30 }, renewalAt: "2026-12-01T00:00:00.000Z" };
  const benefit = { entitlementId: "ent-1", benefitKey: "atm.fee_refund", status: "active", allowance: 5, consumed: 2,
    periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z" };

  it("stores the latest membership result", async () => {
    await applyProviderEvent(db, event("membership.updated", membership));
    expect(await applyProviderEvent(db, event("membership.updated", { ...membership, tier: "basic" }, { createdAt: "2026-09-25T09:00:00.000Z" })))
      .toMatchObject({ status: "stale" });
    expect(await readMembership(db, "alice")).toMatchObject({ tier: "plus", score: 420, qualification: { balanceDays: 30 } });
  });

  it("keeps benefit consumption monotonic and reads only current periods", async () => {
    await applyProviderEvent(db, event("benefit.entitlement.updated", benefit));
    await applyProviderEvent(db, event("benefit.entitlement.updated", { ...benefit, consumed: 1 }));
    await applyProviderEvent(db, event("benefit.entitlement.updated", { ...benefit, entitlementId: "ent-0",
      periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-09-01T00:00:00.000Z" }));
    const current = await readCurrentEntitlements(db, "alice", "2026-09-25T00:00:00.000Z");
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ benefitKey: "atm.fee_refund", consumed: 2, allowance: 5, provider: "bridge" });
  });

  it("rejects a benefit period that ends before it starts", async () => {
    expect(await applyProviderEvent(db, event("benefit.entitlement.updated", { ...benefit, periodEnd: benefit.periodStart })))
      .toMatchObject({ reason: "invalid_payload" });
  });
});

describe("wallet policy projection", () => {
  it("keeps one current row per policy type from the wallet provider", async () => {
    const policy = { policyId: "pol-1", policyType: "spend_limit", configuration: { dailyUsd: 500 }, enabled: true };
    await applyProviderEvent(db, event("wallet.policy.updated", policy, { provider: "privy" }));
    await applyProviderEvent(db, event("wallet.policy.updated", { ...policy, policyId: "pol-2", configuration: { dailyUsd: 250 } },
      { provider: "privy", createdAt: "2026-09-25T11:00:00.000Z" }));
    expect((await db.prepare("SELECT policy_id, policy_type, configuration_json, enabled, updated_at FROM wallet_policies WHERE subject_reference = ?")
      .bind("alice").all()).results).toEqual([{ policy_id: "pol-2", policy_type: "spend_limit",
      configuration_json: JSON.stringify({ dailyUsd: 250, provider: "privy" }), enabled: 1, updated_at: "2026-09-25T11:00:00.000Z" }]);
  });
});

describe("preferences", () => {
  it("returns defaults, then merges partial updates", async () => {
    expect(await readPreferences(db, "alice")).toMatchObject({ notifications: { transactionEmail: true, transactionPush: true }, updatedAt: null });
    await updatePreferences(db, "alice", { notifications: { transactionEmail: false } }, "2026-09-25T10:00:00.000Z");
    await updatePreferences(db, "alice", { notifications: { transactionPush: false } }, "2026-09-25T10:05:00.000Z");
    expect(await readPreferences(db, "alice")).toEqual({
      notifications: { transactionEmail: false, transactionPush: false }, updatedAt: "2026-09-25T10:05:00.000Z" });
  });

  it("falls back to defaults if a stored document is unreadable", async () => {
    sqlite.exec("INSERT INTO user_preferences VALUES ('alice', '{broken', '2026-09-25T10:00:00.000Z')");
    expect(await readPreferences(db, "alice")).toMatchObject({ notifications: { transactionEmail: true } });
  });
});

describe("provider command idempotency", () => {
  const input = { subjectReference: "alice", idempotencyKey: "key-1", commandType: "market_order", provider: "venue", now: new Date("2026-09-25T10:00:00.000Z") };

  it("claims once, reports in-flight and completed commands, and scopes keys to the customer", async () => {
    const first = await claimProviderCommand(db, input);
    expect(first).toMatchObject({ outcome: "claimed" });
    expect(await claimProviderCommand(db, input)).toMatchObject({ outcome: "in_progress" });
    await settleProviderCommand(db, first.key, { status: "completed", providerObjectId: "order-9" });
    expect(await claimProviderCommand(db, input)).toEqual({ outcome: "completed", key: first.key, providerObjectId: "order-9" });
    expect(await claimProviderCommand(db, { ...input, subjectReference: "bob" })).toMatchObject({ outcome: "claimed" });
  });

  it("allows a retry after failure or expiry", async () => {
    const first = await claimProviderCommand(db, input);
    await settleProviderCommand(db, first.key, { status: "failed" });
    expect(await claimProviderCommand(db, input)).toMatchObject({ outcome: "claimed" });
    expect(await claimProviderCommand(db, { ...input, now: new Date("2026-09-27T10:00:00.000Z") })).toMatchObject({ outcome: "claimed" });
  });
});
