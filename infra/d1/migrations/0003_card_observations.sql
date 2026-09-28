-- Card payments, holds, declines, and refunds as Stripe reported them (apps/web/src/lib/cards/observations.ts),
-- so the operations app can list money movement across every customer. A replaceable projection: Stripe is the
-- authority. Recorded from Stripe's webhooks and from each read of the customer's card history. A hold is
-- replaced by its settled transaction once Stripe reports it.
CREATE TABLE card_observations (
  activity_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  card_reference TEXT,
  authorization_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('payment', 'refund')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'declined', 'reversed')),
  amount_usd TEXT NOT NULL,
  merchant TEXT,
  transaction_hash TEXT,
  dispute_status TEXT,
  occurred_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);

CREATE INDEX card_observations_occurred_idx ON card_observations(occurred_at DESC);
CREATE INDEX card_observations_subject_idx ON card_observations(subject_reference, occurred_at DESC);
CREATE INDEX card_observations_authorization_idx ON card_observations(authorization_id);
