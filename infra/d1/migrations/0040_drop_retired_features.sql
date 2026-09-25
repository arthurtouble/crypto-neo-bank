-- Remove storage for retired customer planning, price alerts, swap reminders,
-- the waitlist, and growth campaigns, experiments, events, communications,
-- retention runs, and referrals. No application code reads or writes these
-- tables. Audit events that reference their rows are retained.

-- Children before parents so enforced foreign keys never block a drop.
DROP TABLE IF EXISTS swap_reminder_occurrences;
DROP TABLE IF EXISTS swap_reminder_plans;
DROP TABLE IF EXISTS price_alerts;
DROP TABLE IF EXISTS schedule_occurrences;
DROP TABLE IF EXISTS transfer_schedules;
DROP TABLE IF EXISTS savings_goals;
DROP TABLE IF EXISTS bill_reminder_plans;
DROP TABLE IF EXISTS subscription_projections;
DROP TABLE IF EXISTS income_allocation_plans;
DROP TABLE IF EXISTS growth_waitlist_invites;
DROP TABLE IF EXISTS growth_waitlist;
DROP TABLE IF EXISTS growth_referrals;
DROP TABLE IF EXISTS growth_invite_links;
DROP TABLE IF EXISTS growth_events;
DROP TABLE IF EXISTS growth_experiment_assignments;
DROP TABLE IF EXISTS growth_experiments;
DROP TABLE IF EXISTS growth_campaigns;
DROP TABLE IF EXISTS growth_communications;
DROP TABLE IF EXISTS growth_retention_runs;
