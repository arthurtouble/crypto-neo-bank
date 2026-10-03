-- Deposits a customer bridged to their Aura account on Base from a wallet they connected on another network
-- (apps/web/src/lib/deposits/tracking.ts), so Transactions shows one while it's on its way. Recorded once the source
-- transaction is on chain, from a wallet Privy shows is the customer's, to the LI.FI Diamond. A replaceable projection,
-- never a balance: LI.FI reports progress, and Base shows what arrived.
CREATE TABLE wallet_deposits (
  source_hash TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  source_chain_id INTEGER NOT NULL,
  from_address TEXT NOT NULL,
  tool TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  -- What the quote said would arrive, shown as "about"; the amount that arrives is read from Base.
  expected_amount_raw TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  destination_hash TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE INDEX wallet_deposits_subject_idx ON wallet_deposits(subject_reference, created_at DESC);
CREATE INDEX wallet_deposits_destination_idx ON wallet_deposits(destination_hash);

-- Card purchases through Privy's funding flow. Off until the card provider is confirmed in the Privy app; Privy's own
-- funding setting is the control that stops a purchase, this switch hides the way to start one.
INSERT INTO feature_flags (flag_key, enabled, configuration_json, updated_at, updated_by)
VALUES ('card_deposits', 0, '{}', '2026-10-02T00:00:00.000Z', 'migration')
ON CONFLICT (flag_key) DO NOTHING;
