-- A late Base swap hash is investigation evidence only. The original prepared
-- call and intent remain unchanged; this trigger does not authorize submission.
DROP TRIGGER intent_observation_candidates_prepared_identity_insert;

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
      OR (i.intent_type = 'swap' AND p.semantic_action = 'swap' AND p.submission_phase = 'released')))
BEGIN
  SELECT RAISE(ABORT, 'observation candidate must match a prepared Base transfer or swap');
END;
