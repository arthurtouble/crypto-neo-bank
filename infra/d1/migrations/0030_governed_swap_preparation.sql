-- Only a server-governed Base Swap first step may be released at insertion.
-- Direct transfers and approvals retain the existing step-up guard.
DROP TRIGGER intent_prepared_calls_step_up_insert;

CREATE TRIGGER intent_prepared_calls_step_up_insert
BEFORE INSERT ON intent_prepared_calls
WHEN NEW.submission_phase IS NULL
  OR (NEW.submission_phase = 'released' AND NOT (
    NEW.semantic_action = 'swap' AND NEW.chain_id = 8453 AND NEW.step_index = 0
    AND NEW.reported_hash IS NULL AND NEW.observed_block_hash IS NULL
    AND NEW.verification_state = 'prepared'
    AND EXISTS (SELECT 1 FROM transaction_intents i WHERE i.intent_id = NEW.intent_id
      AND i.intent_type = 'swap' AND i.chain_id = 8453 AND i.status = 'reviewed')
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
