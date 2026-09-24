-- Upgrade databases that applied the earlier growth schema.
-- Keep legacy application records for retention/export; no consent is inferred.

CREATE TABLE IF NOT EXISTS growth_waitlist (
  waitlist_id TEXT PRIMARY KEY,
  email_ciphertext TEXT NOT NULL,
  email_nonce TEXT NOT NULL,
  email_lookup_hmac TEXT NOT NULL UNIQUE,
  country_hint TEXT,
  country_hint_source TEXT NOT NULL CHECK (country_hint_source IN ('cloudflare','unknown')),
  privacy_notice_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','invited','withdrawn')),
  attribution_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS growth_waitlist_status_idx ON growth_waitlist(status, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_waitlist_created_idx ON growth_waitlist(created_at DESC, waitlist_id DESC);

CREATE TABLE IF NOT EXISTS growth_waitlist_invites (
  waitlist_id TEXT PRIMARY KEY REFERENCES growth_waitlist(waitlist_id),
  invite_hash TEXT NOT NULL UNIQUE REFERENCES beta_invites(code_hash),
  verified_country TEXT NOT NULL,
  eligibility_evidence TEXT NOT NULL,
  issued_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS growth_consent_subject_lookup_idx
  ON growth_consent_events(subject_reference, purpose, occurred_at DESC);
