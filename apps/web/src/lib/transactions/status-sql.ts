/** Financial status writes use these exact statements in D1 and SQLite tests. */
export const REPORTED_HASH_CLAIM_SQL = `UPDATE intent_prepared_calls SET reported_hash = ?, verification_state = 'pending', updated_at = ?
  WHERE intent_id = ? AND step_index = ? AND (submission_phase IS NULL OR submission_phase IN ('legacy', 'released'))
    AND (reported_hash IS NULL OR lower(reported_hash) = lower(?)) AND verification_state IN ('prepared', 'pending', 'reported')
    AND expires_at > ?
  AND EXISTS (SELECT 1 FROM transaction_intents i WHERE i.intent_id = intent_prepared_calls.intent_id
    AND i.subject_reference = ? AND i.status IN ('reviewed', 'submitted') AND i.expires_at > ?
    AND EXISTS (SELECT 1 FROM security_profiles s WHERE s.subject_reference = i.subject_reference AND s.account_locked = 0)
    AND EXISTS (SELECT 1 FROM feature_flags f WHERE f.flag_key = ? AND f.enabled = 1 AND f.audience = 'all')
    AND (i.intent_type != 'bridge' OR EXISTS (SELECT 1 FROM feature_flags swap_gate
      WHERE swap_gate.flag_key = 'swaps' AND swap_gate.enabled = 1 AND swap_gate.audience = 'all')))`;

const TERMINAL_INTENT_PREDICATE = `WHERE intent_id = ? AND subject_reference = ? AND status = 'reviewed'
    AND transaction_hash IS NULL
    AND NOT EXISTS (SELECT 1 FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id AND p.reported_hash IS NOT NULL)`;

export const TERMINAL_INTENT_CANCEL_SQL = `UPDATE transaction_intents
  SET status = 'cancelled', failure_reason = NULL, updated_at = ?
  ${TERMINAL_INTENT_PREDICATE}`;

export const TERMINAL_INTENT_FAIL_SQL = `UPDATE transaction_intents
  SET status = 'failed', failure_reason = ?, updated_at = ?
  ${TERMINAL_INTENT_PREDICATE}
    AND intent_type NOT IN ('swap', 'bridge')`;

export const TERMINAL_INTENT_AUDIT_SQL = `INSERT INTO intent_events (event_id, intent_id, subject_reference, event_type, evidence_json, occurred_at)
  SELECT ?, intent_id, subject_reference, ?, ?, ? FROM transaction_intents
  WHERE intent_id = ? AND subject_reference = ? AND status = ? AND updated_at = ?
    AND NOT EXISTS (SELECT 1 FROM intent_events WHERE intent_id = ? AND event_type = ? AND occurred_at = ?)`;

export const TERMINAL_PRODUCT_EVENT_SQL = `INSERT INTO product_events (event_id, subject_reference, session_reference, event_name, surface, properties_json, occurred_at)
  SELECT ?, ?, ?, ?, '/app/activity', ?, ? WHERE EXISTS
    (SELECT 1 FROM intent_events WHERE event_id = ? AND intent_id = ? AND subject_reference = ?)`;
