-- Short-lived LI.FI quotes are server-held proposals, never signing authority.
CREATE TABLE IF NOT EXISTS swap_quote_plans (
  plan_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  destination_asset_id TEXT NOT NULL,
  source_chain_id INTEGER NOT NULL,
  destination_chain_id INTEGER NOT NULL,
  from_amount_raw TEXT NOT NULL,
  recipient TEXT NOT NULL,
  slippage_bps INTEGER NOT NULL,
  to_amount_min_raw TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  approval_spender TEXT,
  route_steps_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(route_steps_json)),
  source_call_json TEXT NOT NULL CHECK (json_valid(source_call_json)),
  route_policy_version TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'superseded')),
  intent_id TEXT REFERENCES transaction_intents(intent_id)
);

CREATE INDEX IF NOT EXISTS swap_quote_plans_scope_idx
  ON swap_quote_plans(subject_reference, wallet_address, status, expires_at);
CREATE INDEX IF NOT EXISTS swap_quote_plans_retention_idx
  ON swap_quote_plans(status, expires_at) WHERE intent_id IS NULL;

CREATE TRIGGER IF NOT EXISTS swap_quote_plans_immutable
BEFORE UPDATE ON swap_quote_plans
WHEN OLD.plan_id IS NOT NEW.plan_id
  OR OLD.subject_reference IS NOT NEW.subject_reference
  OR OLD.wallet_address IS NOT NEW.wallet_address
  OR OLD.source_asset_id IS NOT NEW.source_asset_id
  OR OLD.destination_asset_id IS NOT NEW.destination_asset_id
  OR OLD.source_chain_id IS NOT NEW.source_chain_id
  OR OLD.destination_chain_id IS NOT NEW.destination_chain_id
  OR OLD.from_amount_raw IS NOT NEW.from_amount_raw
  OR OLD.recipient IS NOT NEW.recipient
  OR OLD.slippage_bps IS NOT NEW.slippage_bps
  OR OLD.to_amount_min_raw IS NOT NEW.to_amount_min_raw
  OR OLD.quote_id IS NOT NEW.quote_id
  OR OLD.step_id IS NOT NEW.step_id
  OR OLD.tool_id IS NOT NEW.tool_id
  OR OLD.approval_spender IS NOT NEW.approval_spender
  OR OLD.route_steps_json IS NOT NEW.route_steps_json
  OR OLD.source_call_json IS NOT NEW.source_call_json
  OR OLD.route_policy_version IS NOT NEW.route_policy_version
  OR OLD.catalog_version IS NOT NEW.catalog_version
  OR OLD.observed_at IS NOT NEW.observed_at
  OR OLD.expires_at IS NOT NEW.expires_at
  OR OLD.fingerprint IS NOT NEW.fingerprint
  OR (OLD.intent_id IS NOT NULL AND OLD.intent_id IS NOT NEW.intent_id)
BEGIN
  SELECT RAISE(ABORT, 'swap quote plan is immutable');
END;

CREATE TRIGGER IF NOT EXISTS swap_quote_plans_keep_bound_evidence
BEFORE DELETE ON swap_quote_plans
WHEN OLD.intent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'bound swap quote plan cannot be deleted');
END;
