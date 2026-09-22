-- Customer planning preferences for incoming income. These rows never move funds.
-- A provider-backed mandate and provider-observed account state are required before execution.

CREATE TABLE IF NOT EXISTS income_allocation_plans (
  plan_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('next_income','recurring')),
  spending_percent INTEGER NOT NULL CHECK (spending_percent BETWEEN 0 AND 100),
  goals_percent INTEGER NOT NULL CHECK (goals_percent BETWEEN 0 AND 100),
  earn_percent INTEGER NOT NULL CHECK (earn_percent BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK (status IN ('draft','paused','archived')),
  provider TEXT,
  provider_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference),
  CHECK (spending_percent + goals_percent + earn_percent = 100)
);

CREATE INDEX IF NOT EXISTS income_allocation_subject_idx
  ON income_allocation_plans(subject_reference, status, updated_at DESC);
