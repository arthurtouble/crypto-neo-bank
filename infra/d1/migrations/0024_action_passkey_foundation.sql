-- Action-bound passkey evidence. No credential or authorization created by
-- this migration enables signing or relaxes an existing security policy.

ALTER TABLE security_profiles ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version >= 1);

CREATE TABLE IF NOT EXISTS action_passkey_credentials (
  credential_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  public_key_cose BLOB NOT NULL CHECK (length(public_key_cose) > 0),
  algorithm INTEGER NOT NULL CHECK (algorithm IN (-7, -257)),
  rp_id TEXT NOT NULL CHECK (length(rp_id) > 0),
  sign_count INTEGER NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  counter_risk TEXT NOT NULL DEFAULT 'none' CHECK (counter_risk IN ('none', 'zero', 'regression')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  created_at TEXT NOT NULL,
  activated_at TEXT,
  revoked_at TEXT,
  CHECK (status != 'active' OR activated_at IS NOT NULL),
  CHECK (status != 'revoked' OR revoked_at IS NOT NULL),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);
CREATE INDEX IF NOT EXISTS action_passkey_credentials_subject_idx
  ON action_passkey_credentials(subject_reference, status);
CREATE TRIGGER IF NOT EXISTS action_passkey_credentials_protect
BEFORE UPDATE ON action_passkey_credentials
WHEN OLD.credential_id IS NOT NEW.credential_id OR OLD.subject_reference IS NOT NEW.subject_reference
  OR OLD.public_key_cose IS NOT NEW.public_key_cose OR OLD.algorithm IS NOT NEW.algorithm
  OR OLD.rp_id IS NOT NEW.rp_id OR OLD.created_at IS NOT NEW.created_at
  OR (OLD.status = 'revoked' AND NEW.status != 'revoked')
BEGIN SELECT RAISE(ABORT, 'passkey credential identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS action_passkey_credentials_no_delete
BEFORE DELETE ON action_passkey_credentials
BEGIN SELECT RAISE(ABORT, 'passkey credential evidence cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS action_passkey_challenges (
  challenge_id TEXT PRIMARY KEY,
  challenge_digest TEXT NOT NULL UNIQUE CHECK (length(challenge_digest) > 0),
  subject_reference TEXT NOT NULL,
  session_reference TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'intent_step', 'policy_change', 'credential_change', 'recovery')),
  intent_id TEXT,
  step_index INTEGER CHECK (step_index >= 0),
  call_fingerprint TEXT,
  policy_version INTEGER CHECK (policy_version >= 1),
  proposed_diff_digest TEXT,
  rp_id TEXT NOT NULL CHECK (length(rp_id) > 0),
  origin TEXT NOT NULL CHECK (length(origin) > 0),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at)),
  CHECK (purpose != 'intent_step' OR (session_reference IS NOT NULL AND intent_id IS NOT NULL
    AND step_index IS NOT NULL AND call_fingerprint IS NOT NULL AND policy_version IS NOT NULL)),
  CHECK (purpose != 'policy_change' OR (session_reference IS NOT NULL AND proposed_diff_digest IS NOT NULL
    AND policy_version IS NOT NULL)),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference),
  FOREIGN KEY (intent_id) REFERENCES transaction_intents(intent_id)
);
CREATE INDEX IF NOT EXISTS action_passkey_challenges_subject_idx
  ON action_passkey_challenges(subject_reference, purpose, expires_at);
CREATE TRIGGER IF NOT EXISTS action_passkey_challenges_intent_owner
BEFORE INSERT ON action_passkey_challenges
WHEN NEW.intent_id IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM transaction_intents WHERE intent_id = NEW.intent_id AND subject_reference = NEW.subject_reference)
BEGIN SELECT RAISE(ABORT, 'passkey challenge intent owner differs'); END;
CREATE TRIGGER IF NOT EXISTS action_passkey_challenges_protect
BEFORE UPDATE ON action_passkey_challenges
WHEN OLD.challenge_id IS NOT NEW.challenge_id OR OLD.challenge_digest IS NOT NEW.challenge_digest
  OR OLD.subject_reference IS NOT NEW.subject_reference OR OLD.session_reference IS NOT NEW.session_reference
  OR OLD.purpose IS NOT NEW.purpose OR OLD.intent_id IS NOT NEW.intent_id
  OR OLD.step_index IS NOT NEW.step_index OR OLD.call_fingerprint IS NOT NEW.call_fingerprint
  OR OLD.policy_version IS NOT NEW.policy_version OR OLD.proposed_diff_digest IS NOT NEW.proposed_diff_digest
  OR OLD.rp_id IS NOT NEW.rp_id OR OLD.origin IS NOT NEW.origin
  OR OLD.expires_at IS NOT NEW.expires_at OR OLD.created_at IS NOT NEW.created_at
  OR (OLD.consumed_at IS NOT NULL AND OLD.consumed_at IS NOT NEW.consumed_at)
BEGIN SELECT RAISE(ABORT, 'passkey challenge binding is immutable'); END;
CREATE TRIGGER IF NOT EXISTS action_passkey_challenges_protect_consumed_delete
BEFORE DELETE ON action_passkey_challenges WHEN OLD.consumed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'consumed passkey challenge evidence cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS action_passkey_authorizations (
  authorization_id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE,
  credential_id TEXT NOT NULL,
  subject_reference TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('intent_step', 'policy_change')),
  intent_id TEXT,
  step_index INTEGER CHECK (step_index >= 0),
  call_fingerprint TEXT,
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  proposed_diff_digest TEXT,
  authorized_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (purpose != 'intent_step' OR (intent_id IS NOT NULL AND step_index IS NOT NULL AND call_fingerprint IS NOT NULL)),
  CHECK (purpose != 'policy_change' OR proposed_diff_digest IS NOT NULL),
  FOREIGN KEY (challenge_id) REFERENCES action_passkey_challenges(challenge_id),
  FOREIGN KEY (credential_id) REFERENCES action_passkey_credentials(credential_id),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);
CREATE INDEX IF NOT EXISTS action_passkey_authorizations_intent_idx
  ON action_passkey_authorizations(subject_reference, intent_id, step_index, expires_at);
CREATE TRIGGER IF NOT EXISTS action_passkey_authorizations_match
BEFORE INSERT ON action_passkey_authorizations
WHEN NOT EXISTS (SELECT 1 FROM action_passkey_challenges c JOIN action_passkey_credentials k
    ON k.credential_id = NEW.credential_id AND k.subject_reference = NEW.subject_reference
    WHERE c.challenge_id = NEW.challenge_id AND c.consumed_at IS NOT NULL
      AND c.consumed_at <= NEW.authorized_at
      AND c.subject_reference = NEW.subject_reference AND c.purpose = NEW.purpose
      AND c.intent_id IS NEW.intent_id AND c.step_index IS NEW.step_index
      AND c.call_fingerprint IS NEW.call_fingerprint AND c.policy_version IS NEW.policy_version
      AND c.proposed_diff_digest IS NEW.proposed_diff_digest
      AND c.rp_id = k.rp_id AND k.status = 'active'
      AND c.expires_at > NEW.authorized_at AND NEW.expires_at > NEW.authorized_at
      AND NEW.expires_at <= c.expires_at)
BEGIN SELECT RAISE(ABORT, 'passkey authorization lacks matching consumed challenge'); END;
CREATE TRIGGER IF NOT EXISTS action_passkey_authorizations_no_update
BEFORE UPDATE ON action_passkey_authorizations
BEGIN SELECT RAISE(ABORT, 'passkey authorization evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS action_passkey_authorizations_no_delete
BEFORE DELETE ON action_passkey_authorizations
BEGIN SELECT RAISE(ABORT, 'passkey authorization evidence cannot be deleted'); END;
