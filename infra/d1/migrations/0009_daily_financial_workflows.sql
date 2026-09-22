-- Daily-account workflow state. None of these records authorizes or settles money movement.
-- Wallet recipients continue to use address_book_entries so security delays cannot be bypassed.

CREATE TABLE IF NOT EXISTS bank_beneficiary_projections (
  beneficiary_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_beneficiary_reference TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_hint TEXT,
  rail TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending','verified','restricted','removed')),
  observed_at TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE(subject_reference, provider, provider_beneficiary_reference),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);
CREATE INDEX IF NOT EXISTS bank_beneficiary_subject_idx ON bank_beneficiary_projections(subject_reference, last_used_at DESC, observed_at DESC);

CREATE TABLE IF NOT EXISTS transfer_schedules (
  schedule_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('one_time','weekly','monthly')),
  destination_kind TEXT NOT NULL CHECK (destination_kind IN ('wallet','bank')),
  destination_reference TEXT NOT NULL,
  destination_label TEXT NOT NULL,
  rail TEXT,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  next_run_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('approval_required','provider_managed','paused','cancelled')),
  provider TEXT,
  provider_schedule_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);
CREATE INDEX IF NOT EXISTS transfer_schedules_subject_idx ON transfer_schedules(subject_reference, status, next_run_at);

