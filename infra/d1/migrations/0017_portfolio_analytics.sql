-- Rebuildable history projections. Chain and contracted providers remain
-- authoritative; none of these tables is an account balance or payment ledger.

CREATE TABLE IF NOT EXISTS portfolio_events (
  subject_reference TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  ingestion_version INTEGER NOT NULL CHECK (ingestion_version > 0),
  leg_index INTEGER NOT NULL CHECK (leg_index >= 0),
  account_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  raw_delta TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('contribution','withdrawal','internal_transfer','swap','reward','fee','wrap','unwrap','supply','redeem','borrow','repay','liquidation','unknown')),
  occurred_at TEXT NOT NULL,
  chain_id INTEGER,
  block_number TEXT,
  block_hash TEXT,
  tx_hash TEXT,
  log_index INTEGER,
  finality TEXT NOT NULL CHECK (finality IN ('finalized','pending','reorged')),
  completeness TEXT NOT NULL CHECK (completeness IN ('complete','partial','unavailable','unfinalized')),
  group_id TEXT,
  counterparty_account_id TEXT,
  evidence_hash TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  observed_at TEXT NOT NULL,
  PRIMARY KEY (subject_reference, source_id, source_event_id, ingestion_version, leg_index)
);
CREATE INDEX IF NOT EXISTS portfolio_events_account_time_idx ON portfolio_events(subject_reference, account_id, occurred_at);
CREATE INDEX IF NOT EXISTS portfolio_events_block_idx ON portfolio_events(subject_reference, chain_id, block_number, block_hash);
CREATE INDEX IF NOT EXISTS portfolio_events_tx_idx ON portfolio_events(subject_reference, chain_id, tx_hash);

CREATE TABLE IF NOT EXISTS portfolio_source_checkpoints (
  subject_reference TEXT NOT NULL,
  account_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  cursor TEXT,
  covered_from TEXT,
  covered_through TEXT,
  last_finalized_block TEXT,
  last_finalized_hash TEXT,
  ingestion_version INTEGER NOT NULL CHECK (ingestion_version > 0),
  status TEXT NOT NULL CHECK (status IN ('complete','partial','unavailable','unfinalized')),
  reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subject_reference, account_id, source_id)
);
CREATE INDEX IF NOT EXISTS portfolio_checkpoint_status_idx ON portfolio_source_checkpoints(subject_reference, status, updated_at);

CREATE TABLE IF NOT EXISTS portfolio_price_observations (
  asset_id TEXT NOT NULL,
  day TEXT NOT NULL,
  source_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  usd TEXT NOT NULL,
  methodology TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, day, source_id, version)
);
CREATE INDEX IF NOT EXISTS portfolio_price_day_idx ON portfolio_price_observations(day, asset_id);

CREATE TABLE IF NOT EXISTS portfolio_daily_quantities (
  subject_reference TEXT NOT NULL,
  account_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  day TEXT NOT NULL,
  calculation_version INTEGER NOT NULL CHECK (calculation_version > 0),
  raw_closing_quantity TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  status TEXT NOT NULL CHECK (status IN ('complete','partial','unavailable','unfinalized')),
  PRIMARY KEY (subject_reference, account_id, asset_id, day, calculation_version)
);
CREATE INDEX IF NOT EXISTS portfolio_quantity_day_idx ON portfolio_daily_quantities(subject_reference, day, calculation_version);

CREATE TABLE IF NOT EXISTS portfolio_daily_results (
  subject_reference TEXT NOT NULL,
  day TEXT NOT NULL,
  calculation_version INTEGER NOT NULL CHECK (calculation_version > 0),
  net_value_usd TEXT,
  twr_index TEXT,
  coverage_status TEXT NOT NULL CHECK (coverage_status IN ('complete','partial','unavailable','unfinalized')),
  coverage_json TEXT NOT NULL CHECK (json_valid(coverage_json)),
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (subject_reference, day, calculation_version)
);
CREATE INDEX IF NOT EXISTS portfolio_daily_results_read_idx ON portfolio_daily_results(subject_reference, calculation_version, day DESC);

CREATE TABLE IF NOT EXISTS portfolio_lots (
  subject_reference TEXT NOT NULL,
  account_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  calculation_version INTEGER NOT NULL CHECK (calculation_version > 0),
  acquired_at TEXT NOT NULL,
  raw_acquired TEXT NOT NULL,
  raw_remaining TEXT NOT NULL,
  basis_usd TEXT,
  classification TEXT NOT NULL CHECK (classification IN ('supported','review_required')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  PRIMARY KEY (subject_reference, account_id, asset_id, source_event_id, calculation_version)
);
CREATE INDEX IF NOT EXISTS portfolio_lots_read_idx ON portfolio_lots(subject_reference, account_id, asset_id, acquired_at);

CREATE TABLE IF NOT EXISTS portfolio_disposals (
  subject_reference TEXT NOT NULL,
  account_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  leg_index INTEGER NOT NULL CHECK (leg_index >= 0),
  calculation_version INTEGER NOT NULL CHECK (calculation_version > 0),
  disposed_at TEXT NOT NULL,
  raw_units TEXT NOT NULL,
  proceeds_usd TEXT,
  basis_usd TEXT,
  gain_usd TEXT,
  classification TEXT NOT NULL CHECK (classification IN ('supported','review_required')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  PRIMARY KEY (subject_reference, account_id, asset_id, source_event_id, leg_index, calculation_version)
);
CREATE INDEX IF NOT EXISTS portfolio_disposals_year_idx ON portfolio_disposals(subject_reference, disposed_at, calculation_version);
