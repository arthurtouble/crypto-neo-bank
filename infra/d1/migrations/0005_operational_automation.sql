-- Latest result for bounded operational checks. This contains no financial authority.
CREATE TABLE IF NOT EXISTS operational_checks (
  check_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  details_json TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
