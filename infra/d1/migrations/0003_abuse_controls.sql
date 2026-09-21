-- Disposable abuse-control counters. Safe to delete or rebuild.
CREATE TABLE IF NOT EXISTS rate_limit_windows (
  bucket_key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_windows_reset_idx ON rate_limit_windows(reset_at);
