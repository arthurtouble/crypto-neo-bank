-- In action-passkey-store's ordered D1 batch, the statement immediately
-- before this INSERT conditionally advances one credential. If it matched
-- zero rows, abort the batch and roll back challenge consumption. changes()
-- does not prove which SQL statement ran before this one; every future
-- authorization writer must use the same reviewed store transaction.
CREATE TRIGGER IF NOT EXISTS action_passkey_authorizations_require_credential_update
BEFORE INSERT ON action_passkey_authorizations
WHEN NEW.purpose = 'intent_step' AND changes() != 1
BEGIN SELECT RAISE(ABORT, 'passkey credential was not advanced in this transaction'); END;
