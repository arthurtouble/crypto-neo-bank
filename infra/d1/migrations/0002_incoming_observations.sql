-- Money received without an Aura action, as the chain showed it (apps/web/src/lib/activity/incoming.ts), so
-- the operations app can list money movement across every customer. A replaceable projection: the chain is the
-- authority. Recorded when the background scan or the customer's Transactions reads it, and updated as the
-- block becomes final.
CREATE TABLE incoming_observations (
  transfer_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  wallet_address TEXT NOT NULL CHECK (wallet_address = lower(wallet_address)),
  chain_id INTEGER NOT NULL CHECK (chain_id > 0),
  transaction_hash TEXT NOT NULL CHECK (transaction_hash = lower(transaction_hash)),
  from_address TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals >= 0),
  amount_raw TEXT NOT NULL,
  amount TEXT NOT NULL,
  final INTEGER NOT NULL CHECK (final IN (0, 1)),
  source TEXT NOT NULL,
  received_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE INDEX incoming_observations_received_idx ON incoming_observations(received_at DESC);
CREATE INDEX incoming_observations_subject_idx ON incoming_observations(subject_reference, received_at DESC);
