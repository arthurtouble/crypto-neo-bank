import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directory = resolve(process.cwd(), "../../infra/d1/migrations");
const migrations = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
const upgrades = ["0040_drop_retired_features.sql", "0041_open_access.sql"];
const at = "2026-09-24T00:00:00.000Z";

let db: DatabaseSync;
afterEach(() => db?.close());

/** An existing D1 database: every earlier migration applied, with live rows in the tables being removed. */
function existingDatabase() {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of migrations.filter((name) => !upgrades.includes(name))) db.exec(readFileSync(resolve(directory, file), "utf8"));
  db.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, onboarding_state, created_at, updated_at)
      VALUES ('alice', 'alice', 'beta_active', '${at}', '${at}');
    INSERT INTO security_profiles (subject_reference, updated_at) VALUES ('alice', '${at}');
    INSERT INTO beta_invites (code_hash, label, cohort, created_at, created_by) VALUES ('invite', 'Founding', 'founding-01', '${at}', 'operator');
    INSERT INTO beta_access (subject_reference, invite_hash, cohort, country_code, status, transaction_limit_usd, terms_version,
      terms_accepted_at, activated_at, updated_at) VALUES ('alice', 'invite', 'founding-01', 'PT', 'active', 25000, 'v1', '${at}', '${at}', '${at}');
    INSERT INTO growth_campaigns (campaign_id, slug, name, campaign_type, status, created_by, created_at, updated_at)
      VALUES ('campaign', 'launch', 'Launch', 'referral', 'closed', 'operator', '${at}', '${at}');
    INSERT INTO growth_invite_links VALUES ('invite', 'campaign', 'alice', 'customer_referral', 'alice', '${at}');
    INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      VALUES ('audit-1', 'alice', 'customer', 'alice', 'savings_goal.archive', 'savings_goal', 'goal-1', '{}', '${at}');
    UPDATE feature_flags SET audience = 'beta' WHERE flag_key = 'swaps';`);
  return db;
}

function upgrade() {
  for (const file of upgrades) db.exec(readFileSync(resolve(directory, file), "utf8"));
}

const tables = () => new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));

describe("open-access and retired-feature migrations on an existing database", () => {
  it("apply with foreign keys enforced and leave no dangling references", () => {
    existingDatabase();
    upgrade();
    expect(db.prepare("SELECT COUNT(*) AS n FROM pragma_foreign_key_check").get()).toMatchObject({ n: 0 });
    for (const name of ["beta_access", "beta_invites", "growth_invite_links", "growth_campaigns", "savings_goals", "swap_reminder_plans"])
      expect(tables().has(name), name).toBe(false);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE sql LIKE '%beta_access%' OR sql LIKE '%beta_invites%'").all()).toEqual([]);
  });

  it("keeps customers, security controls, and audit evidence", () => {
    existingDatabase();
    upgrade();
    expect(db.prepare("SELECT subject_reference FROM subject_profiles").all()).toEqual([{ subject_reference: "alice" }]);
    expect(db.prepare("SELECT account_locked, daily_limit_usd FROM security_profiles WHERE subject_reference = 'alice'").get())
      .toMatchObject({ account_locked: 0, daily_limit_usd: 25000 });
    expect(db.prepare("SELECT action FROM audit_events WHERE audit_id = 'audit-1'").get()).toMatchObject({ action: "savings_goal.archive" });
  });

  it("turns the retired beta flag audience into the customer audience", () => {
    existingDatabase();
    upgrade();
    expect(db.prepare("SELECT audience, updated_by FROM feature_flags WHERE flag_key = 'swaps'").get())
      .toMatchObject({ audience: "all", updated_by: "aura-migration" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM feature_flags WHERE audience = 'beta'").get()).toMatchObject({ n: 0 });
  });

  it("keeps the swap approval guard, now without an invitation requirement", () => {
    existingDatabase();
    const before = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'swap_approval_requests_insert_guard'").get() as { sql: string }).sql;
    upgrade();
    const after = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'swap_approval_requests_insert_guard'").get() as { sql: string }).sql;
    expect(before).toContain("beta_access");
    expect(after).not.toContain("beta_access");
    // Every other condition of the guard is unchanged.
    expect(after).toBe(before.replace("    JOIN beta_access b ON b.subject_reference = i.subject_reference AND b.status = 'active'\n", ""));
  });
});
