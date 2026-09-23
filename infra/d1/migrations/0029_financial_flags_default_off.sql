-- A fresh database must not authorize money movement before operator review.
-- Existing environments are also put into the safe state by this migration;
-- an operator must explicitly re-enable each capability after release gates pass.
UPDATE feature_flags
SET enabled = 0, updated_at = datetime('now'), updated_by = 'migration-0029'
WHERE flag_key IN ('direct_transfers', 'swaps', 'cross_chain', 'defi_actions')
  AND enabled != 0;
