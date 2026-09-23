-- Late direct-transfer reports remain separate from the ordinary submitted call.
-- Candidate and check rows are retained evidence, not settlement authority.
CREATE TABLE IF NOT EXISTS intent_observation_candidates (
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

CREATE UNIQUE INDEX IF NOT EXISTS intent_observation_candidates_chain_hash_unique
  ON intent_observation_candidates(chain_id, transaction_hash COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS intent_observation_candidates_subject_idx
  ON intent_observation_candidates(subject_reference, reported_at DESC);
CREATE INDEX IF NOT EXISTS intent_observation_candidates_retry_idx
  ON intent_observation_candidates(verification_state, last_checked_at)
  WHERE verification_state IN ('unindexed', 'identity_matched', 'check_failed');

CREATE TRIGGER IF NOT EXISTS intent_observation_candidates_immutable_update
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

CREATE TRIGGER IF NOT EXISTS intent_observation_candidates_no_delete
BEFORE DELETE ON intent_observation_candidates
BEGIN
  SELECT RAISE(ABORT, 'observation candidate evidence cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS intent_observation_candidates_hash_insert
BEFORE INSERT ON intent_observation_candidates
WHEN EXISTS (SELECT 1 FROM intent_prepared_calls
  WHERE chain_id = NEW.chain_id AND reported_hash = NEW.transaction_hash COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'transaction hash already belongs to a prepared call');
END;

CREATE TRIGGER IF NOT EXISTS intent_observation_candidates_prepared_identity_insert
BEFORE INSERT ON intent_observation_candidates
WHEN NOT EXISTS (SELECT 1 FROM intent_prepared_calls p
  JOIN transaction_intents i ON i.intent_id = p.intent_id
  WHERE p.intent_id = NEW.intent_id AND p.step_index = NEW.step_index
    AND p.subject_reference = NEW.subject_reference AND i.subject_reference = NEW.subject_reference
    AND i.intent_type = 'transfer' AND p.chain_id = NEW.chain_id
    AND p.call_fingerprint = NEW.prepared_fingerprint
    AND p.submission_phase IS NEW.prepared_phase AND p.reported_hash IS NULL
    AND p.semantic_action IN ('native_transfer', 'erc20_transfer'))
BEGIN
  SELECT RAISE(ABORT, 'observation candidate must match a reviewed Base direct transfer');
END;

CREATE TRIGGER IF NOT EXISTS intent_prepared_calls_candidate_hash_insert
BEFORE INSERT ON intent_prepared_calls
WHEN NEW.reported_hash IS NOT NULL AND EXISTS (SELECT 1 FROM intent_observation_candidates
  WHERE chain_id = NEW.chain_id AND transaction_hash = NEW.reported_hash COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'transaction hash already belongs to an observation candidate');
END;

CREATE TRIGGER IF NOT EXISTS intent_prepared_calls_candidate_hash_update
BEFORE UPDATE OF reported_hash, chain_id ON intent_prepared_calls
WHEN NEW.reported_hash IS NOT NULL AND EXISTS (SELECT 1 FROM intent_observation_candidates
  WHERE chain_id = NEW.chain_id AND transaction_hash = NEW.reported_hash COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'transaction hash already belongs to an observation candidate');
END;

CREATE TABLE IF NOT EXISTS intent_observation_checks (
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

CREATE INDEX IF NOT EXISTS intent_observation_checks_report_idx
  ON intent_observation_checks(report_id, checked_at DESC);

CREATE TRIGGER IF NOT EXISTS intent_observation_checks_no_update
BEFORE UPDATE ON intent_observation_checks
BEGIN
  SELECT RAISE(ABORT, 'observation checks are immutable');
END;

CREATE TRIGGER IF NOT EXISTS intent_observation_checks_no_delete
BEFORE DELETE ON intent_observation_checks
BEGIN
  SELECT RAISE(ABORT, 'observation check evidence cannot be deleted');
END;
