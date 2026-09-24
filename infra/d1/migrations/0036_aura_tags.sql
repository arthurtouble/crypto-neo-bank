-- Customer-owned public address directory. Never a balance or settlement ledger.
-- Inactive claims stay reserved so a previously shared payment link cannot be reassigned.
CREATE TABLE IF NOT EXISTS aura_tags (
  tag TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  receiving_address TEXT NOT NULL,
  display_name TEXT NOT NULL,
  public_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_enabled IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS aura_tags_current_owner_idx ON aura_tags(subject_reference) WHERE active = 1;
CREATE INDEX IF NOT EXISTS aura_tags_public_idx ON aura_tags(tag, public_enabled, active);
