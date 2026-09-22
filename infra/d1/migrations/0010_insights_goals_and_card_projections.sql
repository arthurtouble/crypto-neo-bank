-- Product-planning state and disposable provider projections.
-- These records are never a balance, ledger, settlement record, or source of financial authority.

CREATE TABLE IF NOT EXISTS savings_goals (
  goal_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  name TEXT NOT NULL,
  target_amount TEXT NOT NULL,
  target_asset TEXT NOT NULL CHECK (target_asset IN ('USD','USDC')),
  target_date TEXT,
  source_kind TEXT CHECK (source_kind IN ('provider','chain')),
  source_reference TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','paused','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);
CREATE INDEX IF NOT EXISTS savings_goals_subject_idx ON savings_goals(subject_reference, status, created_at DESC);

CREATE TABLE IF NOT EXISTS card_account_projections (
  card_reference TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_customer_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('eligible','pending','active','frozen','closed','restricted')),
  form_factor TEXT CHECK (form_factor IN ('virtual','physical')),
  network TEXT CHECK (network IN ('visa','mastercard')),
  last_four TEXT,
  daily_limit TEXT,
  monthly_limit TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  observed_at TEXT NOT NULL,
  UNIQUE(subject_reference, provider, card_reference),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);
CREATE INDEX IF NOT EXISTS card_account_subject_idx ON card_account_projections(subject_reference, status, observed_at DESC);

