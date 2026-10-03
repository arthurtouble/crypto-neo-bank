-- Perps on Hyperliquid and predictions on Polymarket (apps/web/src/lib/markets). Aura is a front end: the customer's
-- Privy wallet owns each venue account, and balances, positions, and orders are read from the venue every time.
-- None of these rows is a balance or proof that anything happened at a venue.

-- How a customer's wallet is connected to a venue. Hyperliquid: the trading key (a Privy server wallet Aura's server
-- signs orders with, which Hyperliquid never lets withdraw) the customer approved. Polymarket: the deposit wallet
-- their Privy wallet owns, and its order-book API credentials, encrypted (they can't move funds or sign orders).
CREATE TABLE market_accounts (
  subject_reference TEXT NOT NULL,
  venue TEXT NOT NULL CHECK (venue IN ('hyperliquid', 'polymarket')),
  owner_address TEXT NOT NULL,
  trading_wallet_id TEXT,
  trading_wallet_address TEXT,
  venue_wallet_address TEXT,
  credentials_ciphertext TEXT,
  -- 'pending' until the customer's approval reached the venue, 'ready' after.
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subject_reference, venue),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

-- Something the customer's wallet must sign for a venue (an approval, an order, a withdrawal), waiting for their
-- passkey. Short-lived and used once, like step_up_challenges.
CREATE TABLE market_signature_requests (
  request_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  venue TEXT NOT NULL CHECK (venue IN ('hyperliquid', 'polymarket')),
  purpose TEXT NOT NULL,
  typed_data_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE INDEX market_signature_requests_expiry_idx ON market_signature_requests(expires_at);

-- What Aura sent to a venue for the customer, and the venue's answer: evidence of the request, not of the result.
-- The venue's own records (fills, positions, ledger) are what Transactions and Markets show as settled.
CREATE TABLE market_operations (
  operation_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  venue TEXT NOT NULL CHECK (venue IN ('hyperliquid', 'polymarket')),
  kind TEXT NOT NULL CHECK (kind IN ('setup', 'order', 'cancel', 'leverage', 'withdraw', 'redeem')),
  summary_json TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'accepted', 'rejected', 'failed')),
  status_reason TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE INDEX market_operations_subject_idx ON market_operations(subject_reference, created_at DESC);

INSERT INTO feature_flags (flag_key, enabled, configuration_json, updated_at, updated_by)
VALUES ('perps', 0, '{}', '2026-10-03T00:00:00.000Z', 'migration'),
       ('predictions', 0, '{}', '2026-10-03T00:00:00.000Z', 'migration')
ON CONFLICT (flag_key) DO NOTHING;
