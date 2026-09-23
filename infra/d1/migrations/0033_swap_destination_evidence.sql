-- Retained bridge-delivery observations, not a balance or settlement ledger.
-- Source transaction identity remains on transaction_intents and intent_prepared_calls.
CREATE TABLE IF NOT EXISTS swap_destination_observations (
  intent_id TEXT PRIMARY KEY REFERENCES transaction_intents(intent_id),
  subject_reference TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES swap_quote_plans(plan_id),
  plan_fingerprint TEXT NOT NULL CHECK (length(plan_fingerprint) = 66 AND substr(plan_fingerprint, 1, 2) = '0x'
    AND lower(substr(plan_fingerprint, 3)) NOT GLOB '*[^0-9a-f]*'),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 66 AND substr(source_hash, 1, 2) = '0x'
    AND lower(substr(source_hash, 3)) NOT GLOB '*[^0-9a-f]*'),
  destination_chain_id INTEGER NOT NULL CHECK (destination_chain_id > 0),
  destination_hash TEXT CHECK (destination_hash IS NULL OR (length(destination_hash) = 66
    AND substr(destination_hash, 1, 2) = '0x'
    AND lower(substr(destination_hash, 3)) NOT GLOB '*[^0-9a-f]*')),
  observed_block_hash TEXT CHECK (observed_block_hash IS NULL OR (length(observed_block_hash) = 66
    AND substr(observed_block_hash, 1, 2) = '0x'
    AND lower(substr(observed_block_hash, 3)) NOT GLOB '*[^0-9a-f]*')),
  provider_status TEXT NOT NULL CHECK (provider_status IN ('PENDING', 'DONE', 'PARTIAL', 'REFUNDED', 'FAILED')),
  verification_state TEXT NOT NULL CHECK (verification_state IN
    ('pending', 'complete', 'partial', 'refund_reported', 'failed', 'inconsistent', 'reorged')),
  reason_code TEXT,
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS swap_destination_chain_hash_unique
  ON swap_destination_observations(destination_chain_id, destination_hash COLLATE NOCASE)
  WHERE destination_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS swap_destination_pending_idx
  ON swap_destination_observations(verification_state, checked_at)
  WHERE verification_state != 'complete';

CREATE TRIGGER IF NOT EXISTS swap_destination_bound_insert
BEFORE INSERT ON swap_destination_observations
WHEN NOT EXISTS (
  SELECT 1 FROM transaction_intents i
  JOIN swap_quote_plans p ON p.plan_id = NEW.plan_id AND p.intent_id = i.intent_id
  WHERE i.intent_id = NEW.intent_id AND i.intent_type = 'bridge'
    AND i.status IN ('submitted', 'confirmed')
    AND i.subject_reference = NEW.subject_reference
    AND i.route_reference = 'swap-plan:' || p.plan_id
    AND i.chain_id = p.source_chain_id
    AND lower(i.transaction_hash) = lower(NEW.source_hash)
    AND p.subject_reference = NEW.subject_reference
    AND p.fingerprint = NEW.plan_fingerprint
    AND p.destination_chain_id = NEW.destination_chain_id
)
BEGIN
  SELECT RAISE(ABORT, 'destination evidence is not bound to a bridge plan');
END;

CREATE TRIGGER IF NOT EXISTS swap_destination_immutable_update
BEFORE UPDATE ON swap_destination_observations
WHEN OLD.intent_id IS NOT NEW.intent_id
  OR OLD.subject_reference IS NOT NEW.subject_reference
  OR OLD.plan_id IS NOT NEW.plan_id
  OR OLD.plan_fingerprint IS NOT NEW.plan_fingerprint
  OR OLD.source_hash IS NOT NEW.source_hash
  OR OLD.destination_chain_id IS NOT NEW.destination_chain_id
  OR (OLD.destination_hash IS NOT NULL AND lower(OLD.destination_hash) IS NOT lower(NEW.destination_hash))
  OR (OLD.observed_block_hash IS NOT NULL AND lower(OLD.observed_block_hash) IS NOT lower(NEW.observed_block_hash))
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'destination evidence identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS swap_destination_no_delete
BEFORE DELETE ON swap_destination_observations
BEGIN
  SELECT RAISE(ABORT, 'destination evidence cannot be deleted');
END;
