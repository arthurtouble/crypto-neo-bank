CREATE TABLE IF NOT EXISTS provider_customer_links (
  subject_reference TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subject_reference, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_customer_external
  ON provider_customer_links(provider, external_customer_id);
