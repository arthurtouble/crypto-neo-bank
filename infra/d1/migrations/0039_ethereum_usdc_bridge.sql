-- Extend reviewed LI.FI Across source steps to Ethereum USDC. The bridge's
-- destination remains unconfirmed until independently observed.
DROP TRIGGER intent_prepared_calls_step_up_insert;

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

-- An exact ERC-20 allowance is a separate on-chain prerequisite, never a
-- bridge release. Retain the existing direct-Swap branch unchanged.
DROP TRIGGER swap_approval_requests_insert_guard;

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
    JOIN beta_access b ON b.subject_reference = i.subject_reference AND b.status = 'active'
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

-- A late hash remains observation evidence only, never renewed authorization.
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
