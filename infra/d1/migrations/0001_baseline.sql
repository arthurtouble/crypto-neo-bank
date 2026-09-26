-- Aura D1 baseline schema.
--
-- Squashed on 25 September 2026 from migrations 0001-0042, minus the tables
-- for removed features (portfolio history and tax lots, action passkeys,
-- consent_receipts, position_projections). No production database had been
-- migrated, so the numbered history was retired; it remains in git history.
--
-- Until the first production migration, edit this file directly. After that,
-- migrations are append-only again.
--
-- D1 never owns money. These tables hold projections, preferences, consent,
-- idempotency, and audit records. See docs/architecture/architecture.md.

CREATE TABLE webhook_receipts (
  event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject_reference TEXT,
  payload_sha256 TEXT NOT NULL,
  provider_created_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('received', 'enqueued', 'processed', 'failed')),
  processed_at TEXT,
  last_error TEXT
);

CREATE INDEX webhook_receipts_status_idx ON webhook_receipts (processing_status, received_at);

CREATE INDEX webhook_receipts_subject_idx ON webhook_receipts (subject_reference, received_at);

CREATE TABLE command_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  command_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_object_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE user_preferences (
  subject_reference TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE subject_profiles (
  subject_reference TEXT PRIMARY KEY,
  privy_user_reference TEXT NOT NULL UNIQUE,
  display_name TEXT,
  country_code TEXT,
  onboarding_state TEXT NOT NULL DEFAULT 'wallet_ready',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE wallet_policies (
  policy_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  policy_type TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(subject_reference, policy_type)
);

CREATE TABLE membership_projections (
  subject_reference TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  score INTEGER NOT NULL,
  qualification_json TEXT NOT NULL,
  qualifying_since TEXT,
  renewal_at TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE TABLE benefit_entitlements (
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

CREATE TABLE operational_issues (
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

CREATE INDEX operational_issues_queue_idx ON operational_issues(status, severity, opened_at);

CREATE TABLE audit_events (
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

CREATE INDEX audit_events_subject_idx ON audit_events(subject_reference, occurred_at DESC);

CREATE TABLE rate_limit_windows (
  bucket_key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE INDEX rate_limit_windows_reset_idx ON rate_limit_windows(reset_at);

CREATE TABLE address_book_entries (
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

CREATE INDEX address_book_subject_idx ON address_book_entries(subject_reference, created_at DESC);

CREATE TABLE onboarding_progress (
  subject_reference TEXT PRIMARY KEY,
  network_guide_read_at TEXT,
  risk_guide_read_at TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE TABLE consent_evidence (
  consent_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  document_key TEXT NOT NULL,
  document_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  UNIQUE(subject_reference, document_key, document_version),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE TABLE product_events (
  event_id TEXT PRIMARY KEY,
  subject_reference TEXT,
  session_reference TEXT NOT NULL,
  event_name TEXT NOT NULL,
  surface TEXT NOT NULL,
  properties_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX product_events_name_idx ON product_events(event_name, occurred_at DESC);

CREATE INDEX product_events_subject_idx ON product_events(subject_reference, occurred_at DESC);

CREATE TABLE support_cases (
  case_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  action_id TEXT,
  category TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference),
  FOREIGN KEY (action_id) REFERENCES actions(action_id)
);

CREATE INDEX support_cases_queue_idx ON support_cases(status, priority, created_at);

CREATE TABLE operational_checks (
  check_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  details_json TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE TABLE customer_feedback (
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

CREATE INDEX customer_feedback_queue_idx ON customer_feedback(status, created_at);

CREATE TABLE incident_updates (
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

CREATE INDEX incident_updates_public_idx ON incident_updates(published, updated_at DESC);

-- The customer's account at a regulated provider (Bridge, Rain). The provider is authoritative for its status.
CREATE TABLE provider_customer_links (
  subject_reference TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('bridge', 'rain')),
  -- Bridge creates the customer only after verification, so this can start empty.
  external_customer_id TEXT,
  onboarding_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'closed')),
  kyc_status TEXT,
  tos_status TEXT,
  onboarding_url TEXT,
  observed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subject_reference, provider),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE UNIQUE INDEX idx_provider_customer_external
  ON provider_customer_links(provider, external_customer_id);

CREATE UNIQUE INDEX idx_provider_customer_onboarding
  ON provider_customer_links(provider, onboarding_reference);

CREATE TABLE data_requests (
  request_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('export','delete','withdraw_consent')),
  status TEXT NOT NULL CHECK (status IN ('received','processing','completed','rejected')),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  handled_by TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE bank_beneficiary_projections (
  beneficiary_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_beneficiary_reference TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_hint TEXT,
  rail TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending','verified','restricted','removed')),
  observed_at TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE(subject_reference, provider, provider_beneficiary_reference),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE INDEX bank_beneficiary_subject_idx ON bank_beneficiary_projections(subject_reference, last_used_at DESC, observed_at DESC);

CREATE TABLE card_account_projections (
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

CREATE INDEX card_account_subject_idx ON card_account_projections(subject_reference, status, observed_at DESC);

CREATE TABLE aura_tags (
  tag TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  receiving_address TEXT NOT NULL,
  display_name TEXT NOT NULL,
  public_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_enabled IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, public_bank_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_bank_enabled IN (0, 1)));

CREATE UNIQUE INDEX aura_tags_current_owner_idx ON aura_tags(subject_reference) WHERE active = 1;

CREATE INDEX aura_tags_public_idx ON aura_tags(tag, public_enabled, active);

CREATE TABLE feature_flags (
  flag_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'operations')),
  configuration_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE consent_events (
  consent_event_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('service_updates', 'marketing')),
  action TEXT NOT NULL CHECK (action IN ('granted', 'withdrawn')),
  notice_version TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX consent_events_lookup_idx ON consent_events(subject_reference, purpose, occurred_at DESC);


CREATE TABLE security_profiles (
  subject_reference TEXT PRIMARY KEY,
  account_locked INTEGER NOT NULL DEFAULT 0 CHECK (account_locked IN (0, 1)),
  enforce_address_book INTEGER NOT NULL DEFAULT 0 CHECK (enforce_address_book IN (0, 1)),
  new_address_delay_seconds INTEGER NOT NULL DEFAULT 14400 CHECK (new_address_delay_seconds BETWEEN 0 AND 604800),
  daily_limit_cents INTEGER CHECK (daily_limit_cents IS NULL OR daily_limit_cents > 0),
  updated_at TEXT NOT NULL,
  policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version >= 1),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

-- One row per customer money movement. See docs/architecture/money-actions.md.
CREATE TABLE actions (
  action_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  wallet_address TEXT NOT NULL CHECK (wallet_address = lower(wallet_address) AND length(wallet_address) = 42),
  kind TEXT NOT NULL CHECK (kind IN ('transfer', 'earn', 'route')),
  chain_id INTEGER NOT NULL CHECK (chain_id > 0),
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  calls_json TEXT NOT NULL CHECK (json_valid(calls_json) AND json_array_length(calls_json) BETWEEN 1 AND 8),
  calls_fingerprint TEXT NOT NULL,
  effects_json TEXT NOT NULL CHECK (json_valid(effects_json)),
  counts_toward_limit INTEGER NOT NULL CHECK (counts_toward_limit IN (0, 1)),
  usd_cents INTEGER CHECK (usd_cents IS NULL OR usd_cents >= 0),
  valuation_source TEXT,
  route_quote_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'submitted', 'settling', 'confirmed', 'failed', 'expired')),
  transaction_hash TEXT CHECK (transaction_hash IS NULL OR (length(transaction_hash) = 66 AND transaction_hash = lower(transaction_hash))),
  -- Privy's transaction ID for an operation Aura relayed; the chain hash follows once it lands.
  relay_reference TEXT UNIQUE CHECK (relay_reference IS NULL OR length(relay_reference) BETWEEN 1 AND 200),
  destination_chain_id INTEGER,
  destination_transaction_hash TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  submitted_at TEXT,
  settled_at TEXT,
  checked_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE UNIQUE INDEX actions_chain_hash_unique ON actions(chain_id, transaction_hash) WHERE transaction_hash IS NOT NULL;

CREATE INDEX actions_subject_idx ON actions(subject_reference, created_at DESC);

CREATE INDEX actions_open_idx ON actions(status, checked_at) WHERE status IN ('submitted', 'settling');

CREATE TRIGGER actions_identity_immutable
BEFORE UPDATE ON actions
WHEN NEW.subject_reference IS NOT OLD.subject_reference OR NEW.wallet_address IS NOT OLD.wallet_address
  OR NEW.kind IS NOT OLD.kind OR NEW.chain_id IS NOT OLD.chain_id OR NEW.summary_json IS NOT OLD.summary_json
  OR NEW.calls_json IS NOT OLD.calls_json OR NEW.calls_fingerprint IS NOT OLD.calls_fingerprint
  OR NEW.effects_json IS NOT OLD.effects_json OR NEW.counts_toward_limit IS NOT OLD.counts_toward_limit
  OR NEW.usd_cents IS NOT OLD.usd_cents OR NEW.valuation_source IS NOT OLD.valuation_source
  OR NEW.route_quote_id IS NOT OLD.route_quote_id OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS NOT OLD.transaction_hash)
  OR (OLD.relay_reference IS NOT NULL AND NEW.relay_reference IS NOT OLD.relay_reference)
  OR (OLD.destination_transaction_hash IS NOT NULL AND NEW.destination_transaction_hash IS NOT OLD.destination_transaction_hash)
BEGIN
  SELECT RAISE(ABORT, 'action identity is immutable');
END;

CREATE TRIGGER actions_status_forward
BEFORE UPDATE OF status ON actions
WHEN NEW.status IS NOT OLD.status AND (
  OLD.status IN ('confirmed', 'failed')
  OR NEW.status = 'prepared'
  OR (OLD.status = 'settling' AND NEW.status IN ('submitted', 'expired'))
  OR (OLD.status = 'submitted' AND NEW.status = 'expired')
  OR (NEW.status IN ('settling', 'confirmed') AND NEW.transaction_hash IS NULL)
  OR (NEW.status = 'submitted' AND NEW.transaction_hash IS NULL AND NEW.relay_reference IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'action status only moves forward');
END;

CREATE TRIGGER actions_no_delete
BEFORE DELETE ON actions
BEGIN
  SELECT RAISE(ABORT, 'actions are retained as transaction evidence');
END;

CREATE TABLE action_events (
  event_id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (action_id) REFERENCES actions(action_id)
);

CREATE INDEX action_events_action_idx ON action_events(action_id, occurred_at);

CREATE TRIGGER action_events_append_only_update
BEFORE UPDATE ON action_events
BEGIN
  SELECT RAISE(ABORT, 'action events are append-only');
END;

CREATE TRIGGER action_events_append_only_delete
BEFORE DELETE ON action_events
BEGIN
  SELECT RAISE(ABORT, 'action events are append-only');
END;

-- Server-held LI.FI quotes. The browser only ever sees the quote ID.
CREATE TABLE route_quotes (
  quote_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  wallet_address TEXT NOT NULL CHECK (wallet_address = lower(wallet_address)),
  from_asset_id TEXT NOT NULL,
  to_asset_id TEXT NOT NULL,
  from_chain_id INTEGER NOT NULL,
  to_chain_id INTEGER NOT NULL,
  from_amount_raw TEXT NOT NULL,
  to_amount_raw TEXT NOT NULL,
  to_amount_min_raw TEXT NOT NULL,
  tool TEXT NOT NULL,
  calls_json TEXT NOT NULL CHECK (json_valid(calls_json)),
  economics_json TEXT NOT NULL CHECK (json_valid(economics_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  action_id TEXT UNIQUE
);

CREATE INDEX route_quotes_expiry_idx ON route_quotes(expires_at) WHERE action_id IS NULL;

INSERT INTO feature_flags (flag_key, enabled, audience, configuration_json, updated_at, updated_by) VALUES
  ('direct_transfers', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline'),
  ('swaps', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline'),
  ('cross_chain', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline'),
  ('defi_actions', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline'),
  ('fiat_accounts', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline'),
  ('payment_cards', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline');
