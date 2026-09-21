-- Aurel never treats these tables as a financial ledger.
-- All records must remain rebuildable from the named provider or chain source.

CREATE TABLE IF NOT EXISTS webhook_receipts (
  event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject_reference TEXT,
  payload_sha256 TEXT NOT NULL,
  provider_created_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('received', 'enqueued', 'processed', 'failed')),
  processed_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS webhook_receipts_status_idx ON webhook_receipts (processing_status, received_at);
CREATE INDEX IF NOT EXISTS webhook_receipts_subject_idx ON webhook_receipts (subject_reference, received_at);

CREATE TABLE IF NOT EXISTS projection_refreshes (
  refresh_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  subject_reference TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_external_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'completed', 'failed')),
  FOREIGN KEY (event_id) REFERENCES webhook_receipts(event_id)
);

CREATE TABLE IF NOT EXISTS command_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  command_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_object_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_receipts (
  consent_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  document_key TEXT NOT NULL,
  document_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  evidence_reference TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
  subject_reference TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
