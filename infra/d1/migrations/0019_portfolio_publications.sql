-- Latest atomically published, rebuildable portfolio projection for a subject.
-- Versioned daily rows remain append-only; this marker is not a balance ledger.
CREATE TABLE IF NOT EXISTS portfolio_publications (
  subject_reference TEXT PRIMARY KEY,
  input_digest TEXT NOT NULL,
  calculation_version INTEGER NOT NULL CHECK (calculation_version > 0),
  day_from TEXT NOT NULL,
  day_through TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'published'),
  published_at TEXT NOT NULL
);

-- An OHLC revision under the same source/version cannot be silently ignored by
-- an ON CONFLICT DO NOTHING publication racing another Worker request.
CREATE TRIGGER IF NOT EXISTS portfolio_price_observation_immutable
BEFORE INSERT ON portfolio_price_observations
WHEN EXISTS (
  SELECT 1 FROM portfolio_price_observations AS prior
  WHERE prior.asset_id = NEW.asset_id AND prior.day = NEW.day AND prior.source_id = NEW.source_id AND prior.version = NEW.version
    AND (prior.usd != NEW.usd OR prior.methodology != NEW.methodology)
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_price_observation_conflict');
END;
