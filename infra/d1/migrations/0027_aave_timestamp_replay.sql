-- Aave v2 skipped provider rows outside a requested date window before
-- verifying canonical block time. Hold every existing publication, including
-- no-event histories, until its Aave source is replayed under v3 verification.
-- These are rebuildable projections; banking, wallet and audit records remain.
INSERT OR IGNORE INTO portfolio_rebuild_holds (subject_reference, rebuild_id, started_at)
  SELECT subject_reference, lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM portfolio_publications;

DELETE FROM portfolio_source_checkpoints WHERE source_id = 'aave:v3:8453';
DELETE FROM portfolio_events WHERE source_id = 'aave:v3:8453';
