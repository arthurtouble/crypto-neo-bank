-- Append-only, server-authored valuation observations bound to a reviewed intent.
-- Older submitted intents without a row remain unknown and must fail closed in policy.
CREATE TABLE IF NOT EXISTS intent_valuations (
  valuation_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES transaction_intents(intent_id),
  asset_id TEXT NOT NULL,
  raw_units TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  price_usd TEXT NOT NULL,
  market_price_usd TEXT NOT NULL,
  price_source TEXT NOT NULL,
  price_observed_at TEXT NOT NULL,
  valued_at TEXT NOT NULL,
  usd_cents TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  depeg_uncertainty INTEGER NOT NULL CHECK (depeg_uncertainty IN (0, 1))
);
CREATE INDEX IF NOT EXISTS intent_valuations_intent_idx ON intent_valuations(intent_id, valued_at DESC);
CREATE TRIGGER IF NOT EXISTS intent_valuations_no_update BEFORE UPDATE ON intent_valuations BEGIN
  SELECT RAISE(ABORT, 'intent valuation evidence is immutable');
END;
CREATE TRIGGER IF NOT EXISTS intent_valuations_no_delete BEFORE DELETE ON intent_valuations BEGIN
  SELECT RAISE(ABORT, 'intent valuation evidence is immutable');
END;
