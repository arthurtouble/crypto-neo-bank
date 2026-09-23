-- Pre-launch growth records. These tables never authorize access or money movement.

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

CREATE TABLE IF NOT EXISTS growth_campaigns (
  campaign_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  campaign_type TEXT NOT NULL CHECK (campaign_type IN ('founder','partner','content','creator','event','paid','referral')),
  partner_label TEXT,
  approved_countries_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('draft','active','paused','closed')),
  fixed_cost_usd REAL,
  disclosure_type TEXT,
  published_asset_url TEXT,
  approval_evidence TEXT,
  takedown_at TEXT,
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_events (
  event_id TEXT PRIMARY KEY,
  subject_reference TEXT,
  anonymous_session_id TEXT,
  event_name TEXT NOT NULL,
  surface TEXT NOT NULL,
  campaign_id TEXT,
  content_id TEXT,
  properties_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES growth_campaigns(campaign_id)
);
CREATE INDEX IF NOT EXISTS growth_events_name_time_idx ON growth_events(event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS growth_events_subject_idx ON growth_events(subject_reference, occurred_at);

CREATE TABLE IF NOT EXISTS growth_invite_links (
  invite_hash TEXT PRIMARY KEY REFERENCES beta_invites(code_hash),
  campaign_id TEXT REFERENCES growth_campaigns(campaign_id),
  referrer_subject_reference TEXT,
  invitation_type TEXT NOT NULL CHECK (invitation_type IN ('operator','partner','customer_referral')),
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_experiments (
  experiment_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  hypothesis TEXT NOT NULL,
  primary_metric TEXT NOT NULL,
  variants_json TEXT NOT NULL,
  guardrails_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('draft','running','stopped','completed')),
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS growth_experiment_assignments (
  experiment_id TEXT NOT NULL REFERENCES growth_experiments(experiment_id),
  assignment_key TEXT NOT NULL,
  variant TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (experiment_id, assignment_key)
);

CREATE TABLE IF NOT EXISTS growth_communications (
  communication_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('beta_operational','marketing')),
  template_key TEXT NOT NULL,
  template_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_reference TEXT,
  status TEXT NOT NULL CHECK (status IN ('accepted','rejected','delivered','failed','suppressed')),
  sent_at TEXT,
  delivered_at TEXT,
  failed_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_consent_events (
  consent_event_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('beta_operational','marketing')),
  action TEXT NOT NULL CHECK (action IN ('granted','withdrawn')),
  notice_version TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS growth_consent_lookup_idx ON growth_consent_events(subject_reference, purpose, occurred_at DESC);

CREATE TABLE IF NOT EXISTS growth_referrals (
  referral_id TEXT PRIMARY KEY,
  referrer_subject_reference TEXT NOT NULL,
  invite_hash TEXT NOT NULL UNIQUE REFERENCES beta_invites(code_hash),
  status TEXT NOT NULL CHECK (status IN ('active','redeemed','expired','revoked')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_subject_reference TEXT,
  redeemed_at TEXT,
  revoked_at TEXT,
  revocation_reason TEXT
);
CREATE INDEX IF NOT EXISTS growth_referrals_referrer_idx ON growth_referrals(referrer_subject_reference, status, issued_at DESC);

CREATE TABLE IF NOT EXISTS growth_data_requests (
  request_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('export','delete','withdraw_consent')),
  status TEXT NOT NULL CHECK (status IN ('received','processing','completed','rejected')),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  handled_by TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS growth_retention_runs (
  run_id TEXT PRIMARY KEY,
  rule_version TEXT NOT NULL,
  subject_reference TEXT NOT NULL,
  activation_at TEXT NOT NULL,
  retained_at TEXT,
  result TEXT NOT NULL CHECK (result IN ('retained','not_due','not_retained')),
  evaluated_at TEXT NOT NULL,
  UNIQUE (rule_version, subject_reference)
);
