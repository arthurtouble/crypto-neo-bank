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

CREATE TABLE projection_refreshes (
  refresh_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  subject_reference TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_external_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'completed', 'failed')),
  FOREIGN KEY (event_id) REFERENCES webhook_receipts(event_id)
);

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

CREATE TABLE wallet_references (
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

CREATE TABLE transaction_intents (
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
  release_at TEXT,
  confirmed_at TEXT,
  failure_reason TEXT,
  route_reference TEXT,
  last_checked_at TEXT,
  request_fingerprint TEXT,
  FOREIGN KEY (wallet_reference) REFERENCES wallet_references(wallet_reference)
);

CREATE INDEX transaction_intents_subject_idx ON transaction_intents(subject_reference, created_at DESC);

CREATE INDEX transaction_intents_status_idx ON transaction_intents(status, updated_at);

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

CREATE INDEX transaction_intents_fingerprint_idx ON transaction_intents(subject_reference, request_fingerprint, status, release_at);

CREATE TABLE security_profiles (
  subject_reference TEXT PRIMARY KEY,
  account_locked INTEGER NOT NULL DEFAULT 0,
  enforce_address_book INTEGER NOT NULL DEFAULT 0,
  new_address_delay_seconds INTEGER NOT NULL DEFAULT 86400,
  new_address_threshold_usd REAL NOT NULL DEFAULT 1000,
  daily_limit_usd REAL NOT NULL DEFAULT 25000,
  step_up_threshold_usd REAL NOT NULL DEFAULT 10000,
  updated_at TEXT NOT NULL,
  policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version >= 1),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

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

CREATE TABLE intent_events (
  event_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  subject_reference TEXT NOT NULL,
  event_type TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (intent_id) REFERENCES transaction_intents(intent_id)
);

CREATE INDEX intent_events_intent_idx ON intent_events(intent_id, occurred_at);

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

CREATE TABLE provider_customer_links (
  subject_reference TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subject_reference, provider)
);

CREATE UNIQUE INDEX idx_provider_customer_external
  ON provider_customer_links(provider, external_customer_id);

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

CREATE TABLE intent_prepared_calls (
  intent_id TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK (step_index >= 0),
  subject_reference TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL CHECK (chain_id > 0),
  target_address TEXT NOT NULL,
  native_value TEXT NOT NULL,
  calldata_hash TEXT NOT NULL,
  call_fingerprint TEXT NOT NULL,
  semantic_action TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  expected_effect_json TEXT NOT NULL CHECK (json_valid(expected_effect_json)),
  reported_hash TEXT,
  observed_block_hash TEXT,
  verification_state TEXT NOT NULL DEFAULT 'prepared'
    CHECK (verification_state IN ('prepared', 'reported', 'pending', 'confirmed', 'failed', 'partial', 'replaced', 'reorged', 'inconsistent')),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  submission_phase TEXT
    CHECK (submission_phase IN ('legacy', 'awaiting_step_up', 'released')),
  PRIMARY KEY (intent_id, step_index),
  FOREIGN KEY (intent_id) REFERENCES transaction_intents(intent_id)
);

CREATE UNIQUE INDEX intent_prepared_calls_chain_hash_unique
  ON intent_prepared_calls(chain_id, reported_hash COLLATE NOCASE) WHERE reported_hash IS NOT NULL;

CREATE INDEX intent_prepared_calls_pending_idx
  ON intent_prepared_calls(verification_state, updated_at, expires_at)
  WHERE verification_state IN ('reported', 'pending', 'partial', 'replaced', 'reorged');

CREATE INDEX intent_prepared_calls_subject_idx
  ON intent_prepared_calls(subject_reference, created_at DESC);

CREATE TRIGGER intent_prepared_calls_immutable_update
BEFORE UPDATE ON intent_prepared_calls
WHEN OLD.intent_id IS NOT NEW.intent_id
  OR OLD.step_index IS NOT NEW.step_index
  OR OLD.subject_reference IS NOT NEW.subject_reference
  OR OLD.wallet_address IS NOT NEW.wallet_address
  OR OLD.chain_id IS NOT NEW.chain_id
  OR OLD.target_address IS NOT NEW.target_address
  OR OLD.native_value IS NOT NEW.native_value
  OR OLD.calldata_hash IS NOT NEW.calldata_hash
  OR OLD.call_fingerprint IS NOT NEW.call_fingerprint
  OR OLD.semantic_action IS NOT NEW.semantic_action
  OR OLD.source_reference IS NOT NEW.source_reference
  OR OLD.expires_at IS NOT NEW.expires_at
  OR OLD.expected_effect_json IS NOT NEW.expected_effect_json
BEGIN
  SELECT RAISE(ABORT, 'prepared call is immutable');
END;

CREATE TRIGGER intent_prepared_calls_no_delete
BEFORE DELETE ON intent_prepared_calls
BEGIN
  SELECT RAISE(ABORT, 'prepared call evidence cannot be deleted');
END;

CREATE TABLE intent_valuations (
  valuation_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES transaction_intents(intent_id),
  asset_id TEXT NOT NULL,
  raw_units TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  price_usd TEXT NOT NULL,
  market_price_usd TEXT NOT NULL,
  price_source TEXT NOT NULL,
  price_observed_at TEXT NOT NULL,
  valued_at TEXT NOT NULL,
  usd_cents TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  depeg_uncertainty INTEGER NOT NULL CHECK (depeg_uncertainty IN (0, 1))
);

CREATE INDEX intent_valuations_intent_idx ON intent_valuations(intent_id, valued_at DESC);

CREATE TRIGGER intent_valuations_no_update BEFORE UPDATE ON intent_valuations BEGIN
  SELECT RAISE(ABORT, 'intent valuation evidence is immutable');
END;

CREATE TRIGGER intent_valuations_no_delete BEFORE DELETE ON intent_valuations BEGIN
  SELECT RAISE(ABORT, 'intent valuation evidence is immutable');
END;

CREATE TABLE swap_quote_plans (
  plan_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  destination_asset_id TEXT NOT NULL,
  source_chain_id INTEGER NOT NULL,
  destination_chain_id INTEGER NOT NULL,
  from_amount_raw TEXT NOT NULL,
  recipient TEXT NOT NULL,
  slippage_bps INTEGER NOT NULL,
  to_amount_min_raw TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  approval_spender TEXT,
  route_steps_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(route_steps_json)),
  source_call_json TEXT NOT NULL CHECK (json_valid(source_call_json)),
  route_policy_version TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'superseded')),
  intent_id TEXT REFERENCES transaction_intents(intent_id)
, economics_json TEXT CHECK (economics_json IS NULL OR json_valid(economics_json)));

CREATE INDEX swap_quote_plans_scope_idx
  ON swap_quote_plans(subject_reference, wallet_address, status, expires_at);

CREATE INDEX swap_quote_plans_retention_idx
  ON swap_quote_plans(status, expires_at) WHERE intent_id IS NULL;

CREATE TRIGGER swap_quote_plans_immutable
BEFORE UPDATE ON swap_quote_plans
WHEN OLD.plan_id IS NOT NEW.plan_id
  OR OLD.subject_reference IS NOT NEW.subject_reference
  OR OLD.wallet_address IS NOT NEW.wallet_address
  OR OLD.source_asset_id IS NOT NEW.source_asset_id
  OR OLD.destination_asset_id IS NOT NEW.destination_asset_id
  OR OLD.source_chain_id IS NOT NEW.source_chain_id
  OR OLD.destination_chain_id IS NOT NEW.destination_chain_id
  OR OLD.from_amount_raw IS NOT NEW.from_amount_raw
  OR OLD.recipient IS NOT NEW.recipient
  OR OLD.slippage_bps IS NOT NEW.slippage_bps
  OR OLD.to_amount_min_raw IS NOT NEW.to_amount_min_raw
  OR OLD.quote_id IS NOT NEW.quote_id
  OR OLD.step_id IS NOT NEW.step_id
  OR OLD.tool_id IS NOT NEW.tool_id
  OR OLD.approval_spender IS NOT NEW.approval_spender
  OR OLD.route_steps_json IS NOT NEW.route_steps_json
  OR OLD.source_call_json IS NOT NEW.source_call_json
  OR OLD.route_policy_version IS NOT NEW.route_policy_version
  OR OLD.catalog_version IS NOT NEW.catalog_version
  OR OLD.observed_at IS NOT NEW.observed_at
  OR OLD.expires_at IS NOT NEW.expires_at
  OR OLD.fingerprint IS NOT NEW.fingerprint
  OR (OLD.intent_id IS NOT NULL AND OLD.intent_id IS NOT NEW.intent_id)
BEGIN
  SELECT RAISE(ABORT, 'swap quote plan is immutable');
END;

CREATE TRIGGER swap_quote_plans_keep_bound_evidence
BEFORE DELETE ON swap_quote_plans
WHEN OLD.intent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'bound swap quote plan cannot be deleted');
END;

CREATE TRIGGER swap_quote_plans_economics_immutable
BEFORE UPDATE OF economics_json ON swap_quote_plans
WHEN OLD.economics_json IS NOT NEW.economics_json
BEGIN
  SELECT RAISE(ABORT, 'swap quote plan economics are immutable');
END;

CREATE TRIGGER swap_quote_plans_intent_scope_insert
BEFORE INSERT ON swap_quote_plans
WHEN NEW.intent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM transaction_intents AS intent
  JOIN wallet_references AS wallet ON wallet.wallet_reference = intent.wallet_reference
  WHERE intent.intent_id = NEW.intent_id AND intent.subject_reference = NEW.subject_reference
    AND wallet.subject_reference = NEW.subject_reference AND lower(wallet.address) = lower(NEW.wallet_address)
)
BEGIN
  SELECT RAISE(ABORT, 'swap quote plan intent scope mismatch');
END;

CREATE TRIGGER swap_quote_plans_intent_scope_update
BEFORE UPDATE OF intent_id ON swap_quote_plans
WHEN NEW.intent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM transaction_intents AS intent
  JOIN wallet_references AS wallet ON wallet.wallet_reference = intent.wallet_reference
  WHERE intent.intent_id = NEW.intent_id AND intent.subject_reference = NEW.subject_reference
    AND wallet.subject_reference = NEW.subject_reference AND lower(wallet.address) = lower(NEW.wallet_address)
)
BEGIN
  SELECT RAISE(ABORT, 'swap quote plan intent scope mismatch');
END;

CREATE TRIGGER swap_quote_plans_status_monotonic
BEFORE UPDATE OF status ON swap_quote_plans
WHEN (OLD.status = 'expired' AND NEW.status IS NOT 'expired')
  OR (OLD.status = 'superseded' AND NEW.status NOT IN ('superseded', 'expired'))
BEGIN
  SELECT RAISE(ABORT, 'swap quote plan status cannot be revived');
END;

CREATE TRIGGER intent_prepared_calls_step_up_hold
BEFORE UPDATE ON intent_prepared_calls
WHEN NEW.submission_phase IS NOT OLD.submission_phase
  OR (OLD.submission_phase = 'awaiting_step_up' AND (
    NEW.reported_hash IS NOT OLD.reported_hash
    OR NEW.observed_block_hash IS NOT OLD.observed_block_hash
    OR NEW.verification_state IS NOT OLD.verification_state
  ))
BEGIN
  SELECT RAISE(ABORT, 'step-up plan is not released');
END;

CREATE TABLE intent_observation_candidates (
  report_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK (step_index = 0),
  chain_id INTEGER NOT NULL CHECK (chain_id = 8453),
  transaction_hash TEXT NOT NULL,
  prepared_fingerprint TEXT NOT NULL,
  prepared_phase TEXT CHECK (prepared_phase IN ('legacy', 'awaiting_step_up', 'released')),
  control_reasons_json TEXT NOT NULL CHECK (json_valid(control_reasons_json) AND json_type(control_reasons_json) = 'array'),
  verification_state TEXT NOT NULL DEFAULT 'unindexed'
    CHECK (verification_state IN ('unindexed', 'identity_matched', 'identity_mismatch', 'settled', 'reverted', 'check_failed')),
  canonical_block_hash TEXT,
  effect_reason TEXT,
  reported_at TEXT NOT NULL,
  last_checked_at TEXT,
  FOREIGN KEY (intent_id, step_index) REFERENCES intent_prepared_calls(intent_id, step_index)
);

CREATE UNIQUE INDEX intent_observation_candidates_chain_hash_unique
  ON intent_observation_candidates(chain_id, transaction_hash COLLATE NOCASE);

CREATE INDEX intent_observation_candidates_subject_idx
  ON intent_observation_candidates(subject_reference, reported_at DESC);

CREATE INDEX intent_observation_candidates_retry_idx
  ON intent_observation_candidates(verification_state, last_checked_at)
  WHERE verification_state IN ('unindexed', 'identity_matched', 'check_failed');

CREATE TRIGGER intent_observation_candidates_immutable_update
BEFORE UPDATE ON intent_observation_candidates
WHEN OLD.report_id IS NOT NEW.report_id
  OR OLD.subject_reference IS NOT NEW.subject_reference
  OR OLD.intent_id IS NOT NEW.intent_id
  OR OLD.step_index IS NOT NEW.step_index
  OR OLD.chain_id IS NOT NEW.chain_id
  OR OLD.transaction_hash IS NOT NEW.transaction_hash
  OR OLD.prepared_fingerprint IS NOT NEW.prepared_fingerprint
  OR OLD.prepared_phase IS NOT NEW.prepared_phase
  OR OLD.control_reasons_json IS NOT NEW.control_reasons_json
  OR OLD.reported_at IS NOT NEW.reported_at
BEGIN
  SELECT RAISE(ABORT, 'observation candidate identity is immutable');
END;

CREATE TRIGGER intent_observation_candidates_no_delete
BEFORE DELETE ON intent_observation_candidates
BEGIN
  SELECT RAISE(ABORT, 'observation candidate evidence cannot be deleted');
END;

CREATE TRIGGER intent_observation_candidates_hash_insert
BEFORE INSERT ON intent_observation_candidates
WHEN EXISTS (SELECT 1 FROM intent_prepared_calls
  WHERE chain_id = NEW.chain_id AND reported_hash = NEW.transaction_hash COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'transaction hash already belongs to a prepared call');
END;

CREATE TRIGGER intent_prepared_calls_candidate_hash_insert
BEFORE INSERT ON intent_prepared_calls
WHEN NEW.reported_hash IS NOT NULL AND EXISTS (SELECT 1 FROM intent_observation_candidates
  WHERE chain_id = NEW.chain_id AND transaction_hash = NEW.reported_hash COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'transaction hash already belongs to an observation candidate');
END;

CREATE TRIGGER intent_prepared_calls_candidate_hash_update
BEFORE UPDATE OF reported_hash, chain_id ON intent_prepared_calls
WHEN NEW.reported_hash IS NOT NULL AND EXISTS (SELECT 1 FROM intent_observation_candidates
  WHERE chain_id = NEW.chain_id AND transaction_hash = NEW.reported_hash COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'transaction hash already belongs to an observation candidate');
END;

CREATE TABLE intent_observation_checks (
  check_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  verification_state TEXT NOT NULL
    CHECK (verification_state IN ('unindexed', 'identity_matched', 'identity_mismatch', 'settled', 'reverted', 'check_failed')),
  reason TEXT,
  canonical_block_hash TEXT,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  checked_at TEXT NOT NULL,
  FOREIGN KEY (report_id) REFERENCES intent_observation_candidates(report_id)
);

CREATE INDEX intent_observation_checks_report_idx
  ON intent_observation_checks(report_id, checked_at DESC);

CREATE TRIGGER intent_observation_checks_no_update
BEFORE UPDATE ON intent_observation_checks
BEGIN
  SELECT RAISE(ABORT, 'observation checks are immutable');
END;

CREATE TRIGGER intent_observation_checks_no_delete
BEFORE DELETE ON intent_observation_checks
BEGIN
  SELECT RAISE(ABORT, 'observation check evidence cannot be deleted');
END;

CREATE TABLE swap_approval_requests (
  approval_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  plan_id TEXT NOT NULL UNIQUE,
  token_address TEXT NOT NULL,
  spender_address TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  call_json TEXT NOT NULL,
  call_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'submitted', 'confirmed', 'failed', 'inconsistent')),
  transaction_hash TEXT UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (intent_id) REFERENCES transaction_intents(intent_id),
  FOREIGN KEY (plan_id) REFERENCES swap_quote_plans(plan_id)
);

CREATE INDEX idx_swap_approval_requests_subject
  ON swap_approval_requests(subject_reference, created_at DESC);

CREATE TRIGGER swap_approval_requests_update_guard
BEFORE UPDATE ON swap_approval_requests
WHEN NEW.approval_id != OLD.approval_id OR NEW.subject_reference != OLD.subject_reference
  OR NEW.wallet_address != OLD.wallet_address OR NEW.intent_id != OLD.intent_id
  OR NEW.plan_id != OLD.plan_id OR NEW.token_address != OLD.token_address
  OR NEW.spender_address != OLD.spender_address OR NEW.amount_raw != OLD.amount_raw
  OR NEW.call_json != OLD.call_json OR NEW.call_fingerprint != OLD.call_fingerprint
  OR NEW.expires_at != OLD.expires_at OR NEW.created_at != OLD.created_at
  OR NEW.updated_at < OLD.updated_at
  OR (OLD.status = 'prepared' AND NEW.status NOT IN ('prepared', 'submitted', 'confirmed', 'failed', 'inconsistent'))
  OR (OLD.status = 'submitted' AND NEW.status NOT IN ('submitted', 'confirmed', 'failed', 'inconsistent'))
  OR (OLD.status IN ('confirmed', 'failed', 'inconsistent') AND NEW.status != OLD.status)
  OR (OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS NOT OLD.transaction_hash)
  OR (NEW.status != 'prepared' AND NEW.transaction_hash IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'swap approval request is immutable outside observation');
END;

CREATE TABLE swap_destination_observations (
  intent_id TEXT PRIMARY KEY REFERENCES transaction_intents(intent_id),
  subject_reference TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES swap_quote_plans(plan_id),
  plan_fingerprint TEXT NOT NULL CHECK (length(plan_fingerprint) = 66 AND substr(plan_fingerprint, 1, 2) = '0x'
    AND lower(substr(plan_fingerprint, 3)) NOT GLOB '*[^0-9a-f]*'),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 66 AND substr(source_hash, 1, 2) = '0x'
    AND lower(substr(source_hash, 3)) NOT GLOB '*[^0-9a-f]*'),
  source_call_fingerprint TEXT NOT NULL,
  destination_chain_id INTEGER NOT NULL CHECK (destination_chain_id > 0),
  destination_hash TEXT CHECK (destination_hash IS NULL OR (length(destination_hash) = 66
    AND substr(destination_hash, 1, 2) = '0x'
    AND lower(substr(destination_hash, 3)) NOT GLOB '*[^0-9a-f]*')),
  observed_block_hash TEXT CHECK (observed_block_hash IS NULL OR (length(observed_block_hash) = 66
    AND substr(observed_block_hash, 1, 2) = '0x'
    AND lower(substr(observed_block_hash, 3)) NOT GLOB '*[^0-9a-f]*')),
  provider_status TEXT NOT NULL CHECK (provider_status IN ('NOT_FOUND', 'INVALID', 'PENDING', 'DONE', 'FAILED')),
  provider_substatus TEXT CHECK (provider_substatus IS NULL OR provider_substatus IN ('COMPLETED', 'PARTIAL', 'REFUNDED')),
  verification_state TEXT NOT NULL CHECK (verification_state IN
    ('pending', 'complete', 'partial', 'refund_reported', 'failed', 'inconsistent', 'reorged')),
  reason_code TEXT,
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (verification_state != 'complete' OR (provider_status = 'DONE'
    AND provider_substatus = 'COMPLETED' AND destination_hash IS NOT NULL
    AND observed_block_hash IS NOT NULL))
);

CREATE UNIQUE INDEX swap_destination_chain_hash_unique
  ON swap_destination_observations(destination_chain_id, destination_hash COLLATE NOCASE)
  WHERE destination_hash IS NOT NULL;

CREATE INDEX swap_destination_pending_idx
  ON swap_destination_observations(verification_state, checked_at)
  WHERE verification_state != 'complete';

CREATE TRIGGER swap_destination_bound_insert
BEFORE INSERT ON swap_destination_observations
WHEN NOT EXISTS (
  SELECT 1 FROM transaction_intents i
  JOIN swap_quote_plans p ON p.plan_id = NEW.plan_id AND p.intent_id = i.intent_id
  JOIN intent_prepared_calls source_call ON source_call.intent_id = i.intent_id
    AND source_call.step_index = 0 AND source_call.semantic_action = 'bridge'
    AND source_call.verification_state = 'confirmed'
    AND source_call.chain_id = i.chain_id
    AND source_call.source_reference = 'swap-plan:' || p.plan_id
    AND lower(source_call.reported_hash) = lower(NEW.source_hash)
    AND source_call.call_fingerprint = NEW.source_call_fingerprint
  WHERE i.intent_id = NEW.intent_id AND i.intent_type = 'bridge'
    AND i.status IN ('submitted', 'confirmed')
    AND i.subject_reference = NEW.subject_reference
    AND i.route_reference = 'swap-plan:' || p.plan_id
    AND i.chain_id = p.source_chain_id
    AND lower(i.transaction_hash) = lower(NEW.source_hash)
    AND p.subject_reference = NEW.subject_reference
    AND source_call.subject_reference = NEW.subject_reference
    AND lower(source_call.wallet_address) = lower(p.wallet_address)
    AND p.fingerprint = NEW.plan_fingerprint
    AND p.destination_chain_id = NEW.destination_chain_id
)
BEGIN
  SELECT RAISE(ABORT, 'destination evidence is not bound to a bridge plan');
END;

CREATE TRIGGER swap_destination_immutable_update
BEFORE UPDATE ON swap_destination_observations
WHEN OLD.intent_id IS NOT NEW.intent_id
  OR OLD.subject_reference IS NOT NEW.subject_reference
  OR OLD.plan_id IS NOT NEW.plan_id
  OR OLD.plan_fingerprint IS NOT NEW.plan_fingerprint
  OR OLD.source_hash IS NOT NEW.source_hash
  OR OLD.source_call_fingerprint IS NOT NEW.source_call_fingerprint
  OR OLD.destination_chain_id IS NOT NEW.destination_chain_id
  OR (OLD.destination_hash IS NOT NULL AND lower(OLD.destination_hash) IS NOT lower(NEW.destination_hash))
  OR (OLD.observed_block_hash IS NOT NULL AND lower(OLD.observed_block_hash) IS NOT lower(NEW.observed_block_hash))
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'destination evidence identity is immutable');
END;

CREATE TRIGGER swap_destination_no_delete
BEFORE DELETE ON swap_destination_observations
BEGIN
  SELECT RAISE(ABORT, 'destination evidence cannot be deleted');
END;

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

CREATE TRIGGER intent_prepared_calls_step_up_insert
BEFORE INSERT ON intent_prepared_calls
WHEN NEW.submission_phase IS NULL
  OR (NEW.submission_phase = 'released' AND NOT (
    NEW.chain_id = 8453 AND NEW.step_index = 0
    AND NEW.reported_hash IS NULL AND NEW.observed_block_hash IS NULL
    AND NEW.verification_state = 'prepared'
    AND (
      (NEW.semantic_action = 'swap' AND EXISTS (
        SELECT 1 FROM transaction_intents i WHERE i.intent_id = NEW.intent_id
          AND i.intent_type = 'swap' AND i.chain_id = 8453 AND i.status = 'reviewed'))
      OR
      (NEW.semantic_action = 'bridge' AND json_valid(NEW.expected_effect_json)
        AND json_extract(NEW.expected_effect_json, '$.type') = 'bridge'
        AND EXISTS (
          SELECT 1 FROM transaction_intents i
          JOIN swap_quote_plans p ON p.intent_id = i.intent_id
          WHERE i.intent_id = NEW.intent_id AND i.intent_type = 'bridge'
            AND i.chain_id = 8453 AND i.status = 'reviewed'
            AND i.subject_reference = NEW.subject_reference
            AND i.wallet_reference = 'wallet:' || lower(NEW.wallet_address)
            AND i.route_reference = 'swap-plan:' || p.plan_id
            AND p.subject_reference = NEW.subject_reference
            AND lower(p.wallet_address) = lower(NEW.wallet_address)
            AND p.source_chain_id = 8453 AND p.destination_chain_id IN (1, 42161)
            AND p.source_asset_id = '8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
            AND ((p.destination_chain_id = 1 AND p.destination_asset_id = '1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
              OR (p.destination_chain_id = 42161 AND p.destination_asset_id = '42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831'))
            AND p.tool_id = 'across' AND p.status = 'active'
            AND NEW.source_reference = 'swap-plan:' || p.plan_id
            AND json_extract(NEW.expected_effect_json, '$.sourceAmountRaw') = p.from_amount_raw
            AND json_extract(NEW.expected_effect_json, '$.minimumOutputRaw') = p.to_amount_min_raw
            AND json_extract(NEW.expected_effect_json, '$.destinationChainId') = p.destination_chain_id
            AND json_extract(NEW.expected_effect_json, '$.destinationAssetId') = p.destination_asset_id
        ))
    )
  ))
  OR (NEW.submission_phase = 'awaiting_step_up' AND (
    NEW.reported_hash IS NOT NULL OR NEW.observed_block_hash IS NOT NULL
    OR NEW.verification_state != 'prepared' OR NEW.chain_id != 8453
    OR NEW.step_index != 0
    OR NEW.semantic_action NOT IN ('native_transfer', 'erc20_transfer')
  ))
BEGIN
  SELECT RAISE(ABORT, 'prepared call phase is not permitted');
END;

CREATE TRIGGER intent_observation_candidates_prepared_identity_insert
BEFORE INSERT ON intent_observation_candidates
WHEN NOT EXISTS (SELECT 1 FROM intent_prepared_calls p
  JOIN transaction_intents i ON i.intent_id = p.intent_id
  WHERE p.intent_id = NEW.intent_id AND p.step_index = 0 AND p.step_index = NEW.step_index
    AND p.subject_reference = NEW.subject_reference AND i.subject_reference = NEW.subject_reference
    AND p.chain_id = 8453 AND p.chain_id = NEW.chain_id
    AND p.call_fingerprint = NEW.prepared_fingerprint
    AND p.submission_phase IS NEW.prepared_phase AND p.reported_hash IS NULL
    AND ((i.intent_type = 'transfer' AND p.semantic_action IN ('native_transfer', 'erc20_transfer'))
      OR (i.intent_type = 'swap' AND p.semantic_action = 'swap' AND p.submission_phase = 'released')
      OR (i.intent_type = 'bridge' AND p.semantic_action = 'bridge' AND p.submission_phase = 'released'
        AND EXISTS (SELECT 1 FROM swap_quote_plans plan
          WHERE plan.intent_id = i.intent_id AND plan.subject_reference = i.subject_reference
            AND i.route_reference = 'swap-plan:' || plan.plan_id
            AND p.source_reference = i.route_reference
            AND plan.source_chain_id = 8453 AND plan.destination_chain_id IN (1, 42161)
            AND plan.tool_id = 'across'))))
BEGIN
  SELECT RAISE(ABORT, 'observation candidate must match a prepared Base transfer or swap');
END;

CREATE TABLE IF NOT EXISTS "feature_flags" (
  flag_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'operations')),
  configuration_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TRIGGER swap_approval_requests_insert_guard
BEFORE INSERT ON swap_approval_requests
WHEN NEW.status != 'prepared' OR NEW.transaction_hash IS NOT NULL
  OR NEW.expires_at <= NEW.created_at
  OR json_extract(NEW.call_json, '$.chainId') != 8453
  OR lower(json_extract(NEW.call_json, '$.from')) != NEW.wallet_address
  OR lower(json_extract(NEW.call_json, '$.to')) != NEW.token_address
  OR json_extract(NEW.call_json, '$.value') != '0'
  OR lower(substr(json_extract(NEW.call_json, '$.data'), 1, 10)) != '0x095ea7b3'
  OR length(json_extract(NEW.call_json, '$.data')) != 138
  OR NOT EXISTS (
    SELECT 1 FROM swap_quote_plans p
    JOIN transaction_intents i ON i.intent_id = p.intent_id
    JOIN security_profiles s ON s.subject_reference = i.subject_reference AND s.account_locked = 0
    JOIN feature_flags f ON f.flag_key = 'swaps' AND f.enabled = 1 AND f.audience = 'all'
    WHERE p.plan_id = NEW.plan_id AND p.intent_id = NEW.intent_id
      AND p.subject_reference = NEW.subject_reference AND i.subject_reference = NEW.subject_reference
      AND p.wallet_address = NEW.wallet_address AND p.status = 'active'
      AND p.expires_at > NEW.created_at AND i.expires_at > NEW.created_at
      AND NEW.expires_at <= p.expires_at AND NEW.expires_at <= i.expires_at
      AND i.status = 'reviewed' AND i.chain_id = 8453
      AND i.route_reference = 'swap-plan:' || p.plan_id
      AND json_extract(i.policy_result_json, '$.permitted') = 1
      AND p.source_chain_id = 8453
      AND ((i.intent_type = 'swap' AND p.destination_chain_id = 8453
          AND p.tool_id = 'uniswap_v3_direct')
        OR (i.intent_type = 'bridge' AND p.destination_chain_id IN (1, 42161)
          AND p.tool_id = 'across'
          AND p.source_asset_id = '8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
          AND ((p.destination_chain_id = 1 AND p.destination_asset_id = '1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
              OR (p.destination_chain_id = 42161 AND p.destination_asset_id = '42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831'))
          AND EXISTS (SELECT 1 FROM feature_flags cross_feature
            WHERE cross_feature.flag_key = 'cross_chain' AND cross_feature.enabled = 1
              AND cross_feature.audience = 'all')))
      AND p.approval_spender = NEW.spender_address
      AND p.source_asset_id = '8453:' || NEW.token_address
      AND (p.from_amount_raw = NEW.amount_raw OR NEW.amount_raw = '0')
  )
BEGIN
  SELECT RAISE(ABORT, 'swap approval request is not linked to an active reviewed plan');
END;

CREATE TABLE consent_events (
  consent_event_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('service_updates', 'marketing')),
  action TEXT NOT NULL CHECK (action IN ('granted', 'withdrawn')),
  notice_version TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX consent_events_lookup_idx ON consent_events(subject_reference, purpose, occurred_at DESC);


INSERT INTO feature_flags (flag_key, enabled, audience, configuration_json, updated_at, updated_by) VALUES
  ('direct_transfers', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline'),
  ('swaps', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline'),
  ('cross_chain', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline'),
  ('defi_actions', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline'),
  ('fiat_accounts', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline'),
  ('payment_cards', 0, 'all', '{}', '2026-09-25T00:00:00.000Z', 'baseline');
