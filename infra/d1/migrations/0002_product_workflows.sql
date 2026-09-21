-- Operational and projection records only. None of these tables is an asset ledger.

CREATE TABLE IF NOT EXISTS subject_profiles (
  subject_reference TEXT PRIMARY KEY,
  privy_user_reference TEXT NOT NULL UNIQUE,
  display_name TEXT,
  country_code TEXT,
  onboarding_state TEXT NOT NULL DEFAULT 'wallet_ready',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_references (
  wallet_reference TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_wallet_reference TEXT,
  address TEXT NOT NULL,
  chain_family TEXT NOT NULL,
  control_model TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE(subject_reference, address),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE TABLE IF NOT EXISTS position_projections (
  projection_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  wallet_reference TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  asset_address TEXT NOT NULL,
  asset_symbol TEXT NOT NULL,
  raw_amount TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  protocol TEXT,
  category TEXT NOT NULL,
  source_block TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  freshness_status TEXT NOT NULL,
  UNIQUE(wallet_reference, chain_id, asset_address, protocol),
  FOREIGN KEY (wallet_reference) REFERENCES wallet_references(wallet_reference)
);

CREATE TABLE IF NOT EXISTS transaction_intents (
  intent_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  wallet_reference TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  request_json TEXT NOT NULL,
  policy_result_json TEXT NOT NULL,
  disclosure_version TEXT NOT NULL,
  status TEXT NOT NULL,
  transaction_hash TEXT,
  source_block TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (wallet_reference) REFERENCES wallet_references(wallet_reference)
);

CREATE INDEX IF NOT EXISTS transaction_intents_subject_idx ON transaction_intents(subject_reference, created_at DESC);
CREATE INDEX IF NOT EXISTS transaction_intents_status_idx ON transaction_intents(status, updated_at);

CREATE TABLE IF NOT EXISTS wallet_policies (
  policy_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  policy_type TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(subject_reference, policy_type)
);

CREATE TABLE IF NOT EXISTS membership_projections (
  subject_reference TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  score INTEGER NOT NULL,
  qualification_json TEXT NOT NULL,
  qualifying_since TEXT,
  renewal_at TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benefit_entitlements (
  entitlement_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  benefit_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  allowance INTEGER,
  consumed INTEGER NOT NULL DEFAULT 0,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  provider_reference TEXT,
  UNIQUE(subject_reference, benefit_key, period_start)
);

CREATE TABLE IF NOT EXISTS operational_issues (
  issue_id TEXT PRIMARY KEY,
  subject_reference TEXT,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_reference TEXT,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  assigned_to TEXT,
  opened_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS operational_issues_queue_idx ON operational_issues(status, severity, opened_at);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_id TEXT PRIMARY KEY,
  subject_reference TEXT,
  actor_type TEXT NOT NULL,
  actor_reference TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_reference TEXT,
  evidence_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_subject_idx ON audit_events(subject_reference, occurred_at DESC);

