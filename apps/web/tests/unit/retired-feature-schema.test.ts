import { expect, it } from "vitest";
import { schemaDatabase } from "../support/schema";

const retired = ["savings_goals", "bill_reminder_plans", "subscription_projections", "income_allocation_plans", "transfer_schedules", "schedule_occurrences",
  "price_alerts", "swap_reminder_plans", "swap_reminder_occurrences", "growth_waitlist", "growth_waitlist_invites", "growth_referrals", "growth_invite_links",
  "growth_events", "growth_experiments", "growth_experiment_assignments", "growth_campaigns", "growth_communications", "growth_retention_runs",
  "growth_applications", "growth_subject_links", "growth_attribution", "growth_research_notes",
  "beta_access", "beta_invites", "consent_receipts", "position_projections", "action_passkey_credentials",
  "action_passkey_challenges", "action_passkey_authorizations", "portfolio_events", "portfolio_source_checkpoints",
  "portfolio_price_observations", "portfolio_daily_quantities", "portfolio_daily_results", "portfolio_lots",
  "portfolio_disposals", "portfolio_publications", "portfolio_rebuild_holds"];

it("fresh schema keeps consent and security controls without retired feature or invitation tables", () => {
  const db = schemaDatabase();
  const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
  for (const name of ["security_profiles", "feature_flags", "consent_events", "data_requests", "audit_events"]) expect(names.has(name)).toBe(true);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'swap_approval_requests_insert_guard'").get()).toBeTruthy();
  expect(db.prepare("SELECT COUNT(*) AS n FROM feature_flags WHERE audience = 'beta'").get()).toMatchObject({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM feature_flags WHERE enabled = 1").get()).toMatchObject({ n: 0 });
  for (const name of retired) expect(names.has(name)).toBe(false);
  const dangling = db.prepare(`SELECT name FROM sqlite_master WHERE sql IS NOT NULL AND (${retired.map(() => "sql LIKE ?").join(" OR ")})`).all(...retired.map((name) => `%${name}%`));
  expect(dangling).toEqual([]);
  db.close();
});
