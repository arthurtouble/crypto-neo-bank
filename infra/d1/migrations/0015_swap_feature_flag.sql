-- Independent incident control for swap quotes and execution preparation.
-- Closed until the prepared-call and settlement-evidence flow is fully deployed.
INSERT OR IGNORE INTO feature_flags (flag_key, enabled, audience, configuration_json, updated_at, updated_by)
VALUES ('swaps', 0, 'beta', '{}', datetime('now'), 'migration');
