-- When a saved bank account can first receive a payout: the customer's new-recipient wait
-- (security_profiles.new_address_delay_seconds) after it was added, the same rule as a saved wallet address.
-- With saved-recipients-only on, a payout to an account still waiting is refused (apps/web/src/app/api/money/payouts/route.ts).
-- Accounts saved before this migration (dev only; no production database exists yet) count from when they were saved.
ALTER TABLE bank_beneficiary_projections ADD COLUMN available_at TEXT;

UPDATE bank_beneficiary_projections SET available_at = strftime('%Y-%m-%dT%H:%M:%fZ', observed_at, '+' || COALESCE(
  (SELECT p.new_address_delay_seconds FROM security_profiles p WHERE p.subject_reference = bank_beneficiary_projections.subject_reference), 14400) || ' seconds')
WHERE available_at IS NULL;
