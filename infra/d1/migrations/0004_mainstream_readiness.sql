-- Durable product-control and evidence records. Financial balances remain authoritative onchain/providers.

ALTER TABLE transaction_intents ADD COLUMN release_at TEXT;
ALTER TABLE transaction_intents ADD COLUMN confirmed_at TEXT;
ALTER TABLE transaction_intents ADD COLUMN failure_reason TEXT;
ALTER TABLE transaction_intents ADD COLUMN route_reference TEXT;
ALTER TABLE transaction_intents ADD COLUMN last_checked_at TEXT;
ALTER TABLE transaction_intents ADD COLUMN request_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS transaction_intents_fingerprint_idx ON transaction_intents(subject_reference, request_fingerprint, status, release_at);

CREATE TABLE IF NOT EXISTS security_profiles (
  subject_reference TEXT PRIMARY KEY,
  account_locked INTEGER NOT NULL DEFAULT 0,
  enforce_address_book INTEGER NOT NULL DEFAULT 0,
  new_address_delay_seconds INTEGER NOT NULL DEFAULT 86400,
  new_address_threshold_usd REAL NOT NULL DEFAULT 1000,
  daily_limit_usd REAL NOT NULL DEFAULT 25000,
  step_up_threshold_usd REAL NOT NULL DEFAULT 10000,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE TABLE IF NOT EXISTS address_book_entries (
  entry_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  chain_family TEXT NOT NULL DEFAULT 'evm',
  address TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE(subject_reference, chain_family, address),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);
CREATE INDEX IF NOT EXISTS address_book_subject_idx ON address_book_entries(subject_reference, created_at DESC);

CREATE TABLE IF NOT EXISTS intent_events (
  event_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  subject_reference TEXT NOT NULL,
  event_type TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (intent_id) REFERENCES transaction_intents(intent_id)
);
CREATE INDEX IF NOT EXISTS intent_events_intent_idx ON intent_events(intent_id, occurred_at);

CREATE TABLE IF NOT EXISTS onboarding_progress (
  subject_reference TEXT PRIMARY KEY,
  network_guide_read_at TEXT,
  risk_guide_read_at TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE TABLE IF NOT EXISTS consent_evidence (
  consent_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  document_key TEXT NOT NULL,
  document_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  UNIQUE(subject_reference, document_key, document_version),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE TABLE IF NOT EXISTS product_events (
  event_id TEXT PRIMARY KEY,
  subject_reference TEXT,
  session_reference TEXT NOT NULL,
  event_name TEXT NOT NULL,
  surface TEXT NOT NULL,
  properties_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS product_events_name_idx ON product_events(event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS product_events_subject_idx ON product_events(subject_reference, occurred_at DESC);

CREATE TABLE IF NOT EXISTS support_cases (
  case_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  intent_id TEXT,
  category TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference),
  FOREIGN KEY (intent_id) REFERENCES transaction_intents(intent_id)
);
CREATE INDEX IF NOT EXISTS support_cases_queue_idx ON support_cases(status, priority, created_at);
