-- Aura is open to every signed-in customer. Invitations, cohorts, beta
-- country codes, and beta transaction caps are removed. Account locks,
-- per-account daily limits, and feature flags remain the controls.

-- The swap approval guard required an active beta_access row.
DROP TRIGGER IF EXISTS swap_approval_requests_insert_guard;
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
    JOIN feature_flags f ON f.flag_key = 'swaps' AND f.enabled = 1 AND f.audience IN ('all', 'beta')
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
              AND cross_feature.audience IN ('all', 'beta'))))
      AND p.approval_spender = NEW.spender_address
      AND p.source_asset_id = '8453:' || NEW.token_address
      AND (p.from_amount_raw = NEW.amount_raw OR NEW.amount_raw = '0')
  )
BEGIN
  SELECT RAISE(ABORT, 'swap approval request is not linked to an active reviewed plan');
END;

-- "beta" was equivalent to "all"; keep one customer audience.
UPDATE feature_flags SET audience = 'all', updated_at = datetime('now'), updated_by = 'aura-migration'
WHERE audience = 'beta';

DROP TABLE IF EXISTS beta_access;
DROP TABLE IF EXISTS beta_invites;
