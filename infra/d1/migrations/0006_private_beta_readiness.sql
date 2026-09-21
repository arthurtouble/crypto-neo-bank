-- Private-beta controls and operational evidence. Financial authority remains onchain/providers.

CREATE TABLE IF NOT EXISTS beta_invites (
  code_hash TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  cohort TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  max_redemptions INTEGER NOT NULL DEFAULT 1,
  redemption_count INTEGER NOT NULL DEFAULT 0,
  allowed_countries_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS beta_invites_cohort_idx ON beta_invites(cohort, status, created_at);

CREATE TABLE IF NOT EXISTS beta_access (
  subject_reference TEXT PRIMARY KEY,
  invite_hash TEXT,
  cohort TEXT NOT NULL,
  country_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'closed')),
  transaction_limit_usd REAL NOT NULL DEFAULT 25000,
  terms_version TEXT NOT NULL,
  terms_accepted_at TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference),
  FOREIGN KEY (invite_hash) REFERENCES beta_invites(code_hash)
);
CREATE INDEX IF NOT EXISTS beta_access_cohort_idx ON beta_access(cohort, status, activated_at);

CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'beta', 'operations')),
  configuration_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT OR IGNORE INTO feature_flags (flag_key, enabled, audience, configuration_json, updated_at, updated_by) VALUES
  ('direct_transfers', 1, 'all', '{}', datetime('now'), 'migration'),
  ('cross_chain', 1, 'all', '{}', datetime('now'), 'migration'),
  ('defi_actions', 1, 'all', '{}', datetime('now'), 'migration'),
  ('concierge', 1, 'all', '{}', datetime('now'), 'migration'),
  ('membership_preview', 1, 'all', '{}', datetime('now'), 'migration'),
  ('tokenized_markets', 0, 'beta', '{}', datetime('now'), 'migration'),
  ('fiat_accounts', 0, 'beta', '{}', datetime('now'), 'migration'),
  ('payment_cards', 0, 'beta', '{}', datetime('now'), 'migration');

CREATE TABLE IF NOT EXISTS customer_feedback (
  feedback_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  surface TEXT NOT NULL,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'planned', 'closed')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);
CREATE INDEX IF NOT EXISTS customer_feedback_queue_idx ON customer_feedback(status, created_at);

CREATE TABLE IF NOT EXISTS incident_updates (
  incident_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  impact TEXT NOT NULL,
  message TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  published INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS incident_updates_public_idx ON incident_updates(published, updated_at DESC);

