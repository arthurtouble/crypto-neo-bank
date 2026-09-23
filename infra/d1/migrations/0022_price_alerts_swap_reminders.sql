-- Customer instructions and reminder evidence only. No wallet mandate or settlement authority.
CREATE TABLE IF NOT EXISTS price_alerts (
  alert_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL REFERENCES subject_profiles(subject_reference),
  pair_id TEXT NOT NULL,
  base_asset_id TEXT NOT NULL,
  quote_asset_id TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
  threshold_decimal TEXT NOT NULL CHECK (
    length(threshold_decimal) BETWEEN 1 AND 79
    AND threshold_decimal GLOB '[0-9]*' AND threshold_decimal NOT GLOB '*[^0-9.]*'
    AND length(threshold_decimal) - length(replace(threshold_decimal, '.', '')) <= 1
    AND (substr(threshold_decimal, 1, 1) != '0' OR length(threshold_decimal) = 1 OR substr(threshold_decimal, 2, 1) = '.')
    AND substr(threshold_decimal, -1) != '.'
    AND (instr(threshold_decimal, '.') = 0 OR (instr(threshold_decimal, '.') > 1 AND length(threshold_decimal) - instr(threshold_decimal, '.') BETWEEN 1 AND 18))
    AND (instr(threshold_decimal, '.') = 0 AND length(threshold_decimal) <= 60 OR instr(threshold_decimal, '.') BETWEEN 2 AND 61)
    AND CAST(threshold_decimal AS REAL) > 0
  ),
  hysteresis_bps INTEGER NOT NULL DEFAULT 100 CHECK (hysteresis_bps BETWEEN 0 AND 1000),
  cooldown_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (cooldown_seconds BETWEEN 0 AND 604800),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'cancelled')),
  threshold_version INTEGER NOT NULL DEFAULT 1 CHECK (threshold_version > 0),
  last_source_observed_at TEXT,
  last_observation_id TEXT,
  armed INTEGER NOT NULL DEFAULT 0 CHECK (armed IN (0, 1)),
  last_triggered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (alert_id, subject_reference)
);
CREATE INDEX IF NOT EXISTS price_alerts_subject_status_idx ON price_alerts(subject_reference, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS swap_reminder_plans (
  plan_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL REFERENCES subject_profiles(subject_reference),
  pair_id TEXT NOT NULL,
  base_asset_id TEXT NOT NULL,
  quote_asset_id TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  amount_decimal TEXT NOT NULL CHECK (
    length(amount_decimal) BETWEEN 1 AND 79
    AND amount_decimal GLOB '[0-9]*' AND amount_decimal NOT GLOB '*[^0-9.]*'
    AND length(amount_decimal) - length(replace(amount_decimal, '.', '')) <= 1
    AND (substr(amount_decimal, 1, 1) != '0' OR length(amount_decimal) = 1 OR substr(amount_decimal, 2, 1) = '.')
    AND substr(amount_decimal, -1) != '.'
    AND (instr(amount_decimal, '.') = 0 OR (instr(amount_decimal, '.') > 1 AND length(amount_decimal) - instr(amount_decimal, '.') BETWEEN 1 AND 18))
    AND (instr(amount_decimal, '.') = 0 AND length(amount_decimal) <= 60 OR instr(amount_decimal, '.') BETWEEN 2 AND 61)
    AND CAST(amount_decimal AS REAL) > 0
  ),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('one_time', 'weekly', 'monthly')),
  time_zone TEXT NOT NULL,
  anchor_local TEXT NOT NULL,
  next_due_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'cancelled')),
  plan_version INTEGER NOT NULL DEFAULT 1 CHECK (plan_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (plan_id, subject_reference)
);
CREATE INDEX IF NOT EXISTS swap_reminder_plans_subject_status_idx ON swap_reminder_plans(subject_reference, status, next_due_at);

CREATE TABLE IF NOT EXISTS swap_reminder_occurrences (
  occurrence_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL REFERENCES subject_profiles(subject_reference),
  kind TEXT NOT NULL CHECK (kind IN ('plan', 'alert')),
  plan_id TEXT,
  plan_version INTEGER,
  due_at TEXT,
  alert_id TEXT,
  threshold_version INTEGER,
  crossing_observation_id TEXT,
  observed_price_decimal TEXT,
  source_observed_at TEXT,
  reminder_state TEXT NOT NULL DEFAULT 'due' CHECK (reminder_state IN ('due', 'dismissed', 'superseded', 'expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CHECK ((kind = 'plan' AND plan_id IS NOT NULL AND plan_version IS NOT NULL AND plan_version > 0 AND due_at IS NOT NULL AND alert_id IS NULL AND threshold_version IS NULL AND crossing_observation_id IS NULL AND observed_price_decimal IS NULL AND source_observed_at IS NULL)
    OR (kind = 'alert' AND alert_id IS NOT NULL AND threshold_version IS NOT NULL AND threshold_version > 0 AND crossing_observation_id IS NOT NULL AND observed_price_decimal IS NOT NULL AND source_observed_at IS NOT NULL AND plan_id IS NULL AND plan_version IS NULL AND due_at IS NULL)),
  FOREIGN KEY (plan_id, subject_reference) REFERENCES swap_reminder_plans(plan_id, subject_reference),
  FOREIGN KEY (alert_id, subject_reference) REFERENCES price_alerts(alert_id, subject_reference)
);
CREATE UNIQUE INDEX IF NOT EXISTS swap_reminder_plan_occurrence_unique ON swap_reminder_occurrences(plan_id, plan_version, due_at) WHERE kind = 'plan';
CREATE UNIQUE INDEX IF NOT EXISTS swap_reminder_alert_occurrence_unique ON swap_reminder_occurrences(alert_id, threshold_version, crossing_observation_id) WHERE kind = 'alert';
CREATE INDEX IF NOT EXISTS swap_reminder_occurrences_subject_idx ON swap_reminder_occurrences(subject_reference, reminder_state, created_at DESC);

CREATE TRIGGER IF NOT EXISTS swap_reminder_occurrences_no_delete BEFORE DELETE ON swap_reminder_occurrences
BEGIN SELECT RAISE(ABORT, 'reminder evidence cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS swap_reminder_occurrences_immutable_identity BEFORE UPDATE ON swap_reminder_occurrences
WHEN OLD.occurrence_id IS NOT NEW.occurrence_id OR OLD.subject_reference IS NOT NEW.subject_reference OR OLD.kind IS NOT NEW.kind
  OR OLD.plan_id IS NOT NEW.plan_id OR OLD.plan_version IS NOT NEW.plan_version OR OLD.due_at IS NOT NEW.due_at
  OR OLD.alert_id IS NOT NEW.alert_id OR OLD.threshold_version IS NOT NEW.threshold_version
  OR OLD.crossing_observation_id IS NOT NEW.crossing_observation_id OR OLD.observed_price_decimal IS NOT NEW.observed_price_decimal
  OR OLD.source_observed_at IS NOT NEW.source_observed_at OR OLD.created_at IS NOT NEW.created_at
BEGIN SELECT RAISE(ABORT, 'reminder identity is immutable'); END;
