-- Existing plans remain readable but have unavailable economics until re-quoted.
ALTER TABLE swap_quote_plans ADD COLUMN economics_json TEXT CHECK (economics_json IS NULL OR json_valid(economics_json));

CREATE TRIGGER IF NOT EXISTS swap_quote_plans_economics_immutable
BEFORE UPDATE OF economics_json ON swap_quote_plans
WHEN OLD.economics_json IS NOT NEW.economics_json
BEGIN
  SELECT RAISE(ABORT, 'swap quote plan economics are immutable');
END;

CREATE TRIGGER IF NOT EXISTS swap_quote_plans_intent_scope_insert
BEFORE INSERT ON swap_quote_plans
WHEN NEW.intent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM transaction_intents AS intent
  JOIN wallet_references AS wallet ON wallet.wallet_reference = intent.wallet_reference
  WHERE intent.intent_id = NEW.intent_id AND intent.subject_reference = NEW.subject_reference
    AND wallet.subject_reference = NEW.subject_reference AND lower(wallet.address) = lower(NEW.wallet_address)
)
BEGIN
  SELECT RAISE(ABORT, 'swap quote plan intent scope mismatch');
END;

CREATE TRIGGER IF NOT EXISTS swap_quote_plans_intent_scope_update
BEFORE UPDATE OF intent_id ON swap_quote_plans
WHEN NEW.intent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM transaction_intents AS intent
  JOIN wallet_references AS wallet ON wallet.wallet_reference = intent.wallet_reference
  WHERE intent.intent_id = NEW.intent_id AND intent.subject_reference = NEW.subject_reference
    AND wallet.subject_reference = NEW.subject_reference AND lower(wallet.address) = lower(NEW.wallet_address)
)
BEGIN
  SELECT RAISE(ABORT, 'swap quote plan intent scope mismatch');
END;

CREATE TRIGGER IF NOT EXISTS swap_quote_plans_status_monotonic
BEFORE UPDATE OF status ON swap_quote_plans
WHEN (OLD.status = 'expired' AND NEW.status IS NOT 'expired')
  OR (OLD.status = 'superseded' AND NEW.status NOT IN ('superseded', 'expired'))
BEGIN
  SELECT RAISE(ABORT, 'swap quote plan status cannot be revived');
END;
