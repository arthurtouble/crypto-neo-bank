-- Separate opt-in before publicly exposing a provider's bank instructions.
ALTER TABLE aura_tags ADD COLUMN public_bank_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_bank_enabled IN (0, 1));
