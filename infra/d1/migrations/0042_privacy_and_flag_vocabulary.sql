-- Remove the last private-beta vocabulary and the growth-program naming
-- from privacy records. Behavior is unchanged: "beta" was already folded into
-- "all" by 0041, and beta_operational consent covered operational service
-- messages.

-- The swap approval guard reads feature_flags; drop it while that table is rebuilt.
DROP TRIGGER IF EXISTS swap_approval_requests_insert_guard;

CREATE TABLE feature_flags_next (
  flag_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'operations')),
  configuration_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
INSERT INTO feature_flags_next (flag_key, enabled, audience, configuration_json, updated_at, updated_by)
SELECT flag_key, enabled, CASE WHEN audience = 'operations' THEN 'operations' ELSE 'all' END, configuration_json, updated_at, updated_by
FROM feature_flags;
DROP TABLE feature_flags;
ALTER TABLE feature_flags_next RENAME TO feature_flags;

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

-- Consent history keeps every event; only the purpose name changes.
CREATE TABLE consent_events (
  consent_event_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('service_updates', 'marketing')),
  action TEXT NOT NULL CHECK (action IN ('granted', 'withdrawn')),
  notice_version TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
INSERT INTO consent_events (consent_event_id, subject_reference, purpose, action, notice_version, occurred_at)
SELECT consent_event_id, subject_reference, CASE WHEN purpose = 'beta_operational' THEN 'service_updates' ELSE purpose END,
  action, notice_version, occurred_at
FROM growth_consent_events;
DROP TABLE growth_consent_events;
CREATE INDEX consent_events_lookup_idx ON consent_events(subject_reference, purpose, occurred_at DESC);

ALTER TABLE growth_data_requests RENAME TO data_requests;
