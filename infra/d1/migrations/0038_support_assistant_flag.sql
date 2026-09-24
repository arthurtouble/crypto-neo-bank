-- Preserve the existing support-assistant switch while retiring obsolete
-- concierge and membership-preview controls. Historical flag rows remain.
INSERT OR IGNORE INTO feature_flags
  (flag_key, enabled, audience, configuration_json, updated_at, updated_by)
SELECT 'support_assistant', enabled, audience, configuration_json, datetime('now'), 'aura-migration'
FROM feature_flags WHERE flag_key = 'concierge';

UPDATE feature_flags SET enabled = 0, updated_at = datetime('now'), updated_by = 'aura-migration'
WHERE flag_key IN ('concierge', 'membership_preview');
