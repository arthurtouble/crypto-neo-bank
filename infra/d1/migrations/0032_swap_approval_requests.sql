-- Projection of a customer-authorized ERC-20 approval prerequisite. The token
-- contract, not D1, is the allowance authority. These rows never authorize a
-- swap, and an expired row cannot revoke an approval already mined on chain.
CREATE TABLE IF NOT EXISTS swap_approval_requests (
  approval_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  plan_id TEXT NOT NULL UNIQUE,
  token_address TEXT NOT NULL,
  spender_address TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  call_json TEXT NOT NULL,
  call_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'submitted', 'confirmed', 'failed', 'inconsistent')),
  transaction_hash TEXT UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (intent_id) REFERENCES transaction_intents(intent_id),
  FOREIGN KEY (plan_id) REFERENCES swap_quote_plans(plan_id)
);

CREATE INDEX IF NOT EXISTS idx_swap_approval_requests_subject
  ON swap_approval_requests(subject_reference, created_at DESC);

CREATE TRIGGER IF NOT EXISTS swap_approval_requests_insert_guard
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
      AND i.status = 'reviewed' AND i.intent_type = 'swap' AND i.chain_id = 8453
      AND i.route_reference = 'swap-plan:' || p.plan_id
      AND json_extract(i.policy_result_json, '$.permitted') = 1
      AND p.source_chain_id = 8453 AND p.destination_chain_id = 8453
      AND p.tool_id = 'uniswap_v3_direct'
      AND p.approval_spender = NEW.spender_address
      AND p.source_asset_id = '8453:' || NEW.token_address
      AND (p.from_amount_raw = NEW.amount_raw OR NEW.amount_raw = '0')
  )
BEGIN
  SELECT RAISE(ABORT, 'swap approval request is not linked to an active reviewed plan');
END;

CREATE TRIGGER IF NOT EXISTS swap_approval_requests_update_guard
BEFORE UPDATE ON swap_approval_requests
WHEN NEW.approval_id != OLD.approval_id OR NEW.subject_reference != OLD.subject_reference
  OR NEW.wallet_address != OLD.wallet_address OR NEW.intent_id != OLD.intent_id
  OR NEW.plan_id != OLD.plan_id OR NEW.token_address != OLD.token_address
  OR NEW.spender_address != OLD.spender_address OR NEW.amount_raw != OLD.amount_raw
  OR NEW.call_json != OLD.call_json OR NEW.call_fingerprint != OLD.call_fingerprint
  OR NEW.expires_at != OLD.expires_at OR NEW.created_at != OLD.created_at
  OR NEW.updated_at < OLD.updated_at
  OR (OLD.status = 'prepared' AND NEW.status NOT IN ('prepared', 'submitted', 'confirmed', 'failed', 'inconsistent'))
  OR (OLD.status = 'submitted' AND NEW.status NOT IN ('submitted', 'confirmed', 'failed', 'inconsistent'))
  OR (OLD.status IN ('confirmed', 'failed', 'inconsistent') AND NEW.status != OLD.status)
  OR (OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS NOT OLD.transaction_hash)
  OR (NEW.status != 'prepared' AND NEW.transaction_hash IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'swap approval request is immutable outside observation');
END;
