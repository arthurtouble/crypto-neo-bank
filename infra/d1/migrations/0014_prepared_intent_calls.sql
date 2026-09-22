-- Immutable reviewed calls and independently observed transaction evidence.
-- This table records workflow evidence, not balances or settlement authority.

CREATE TABLE IF NOT EXISTS intent_prepared_calls (
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
  PRIMARY KEY (intent_id, step_index),
  FOREIGN KEY (intent_id) REFERENCES transaction_intents(intent_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS intent_prepared_calls_chain_hash_unique
  ON intent_prepared_calls(chain_id, reported_hash COLLATE NOCASE) WHERE reported_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS intent_prepared_calls_pending_idx
  ON intent_prepared_calls(verification_state, updated_at, expires_at)
  WHERE verification_state IN ('reported', 'pending', 'partial', 'replaced', 'reorged');

CREATE INDEX IF NOT EXISTS intent_prepared_calls_subject_idx
  ON intent_prepared_calls(subject_reference, created_at DESC);

CREATE TRIGGER IF NOT EXISTS intent_prepared_calls_immutable_update
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

CREATE TRIGGER IF NOT EXISTS intent_prepared_calls_no_delete
BEFORE DELETE ON intent_prepared_calls
BEGIN
  SELECT RAISE(ABORT, 'prepared call evidence cannot be deleted');
END;
