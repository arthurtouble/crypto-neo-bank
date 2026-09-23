-- NULL distinguishes historical evidence. New inserts must state their phase;
-- omission must never silently create an executable legacy call.
ALTER TABLE intent_prepared_calls ADD COLUMN submission_phase TEXT
  CHECK (submission_phase IN ('legacy', 'awaiting_step_up', 'released'));

CREATE TRIGGER intent_prepared_calls_step_up_insert
BEFORE INSERT ON intent_prepared_calls
WHEN NEW.submission_phase IS NULL OR NEW.submission_phase = 'released'
  OR (NEW.submission_phase = 'awaiting_step_up' AND (
  NEW.reported_hash IS NOT NULL OR NEW.observed_block_hash IS NOT NULL
  OR NEW.verification_state != 'prepared' OR NEW.chain_id != 8453
  OR NEW.step_index != 0
  OR NEW.semantic_action NOT IN ('native_transfer', 'erc20_transfer')
))
BEGIN
  SELECT RAISE(ABORT, 'step-up plan must be an unsigned Base direct transfer');
END;

-- There is intentionally no release writer yet. Replace this trigger only
-- alongside the reviewed, exact-action authorization and submission gate.
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
