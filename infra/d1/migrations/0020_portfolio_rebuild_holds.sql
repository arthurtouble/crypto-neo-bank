-- A source replay must not expose a prior derived publication as current.
-- This is a rebuildable analytics gate, not an account or payment ledger.
CREATE TABLE IF NOT EXISTS portfolio_rebuild_holds (
  subject_reference TEXT PRIMARY KEY,
  rebuild_id TEXT NOT NULL,
  started_at TEXT NOT NULL
);
