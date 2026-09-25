import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const directory = resolve(process.cwd(), "../../infra/d1/migrations");
const subject = `INSERT INTO subject_profiles (subject_reference, privy_user_reference, onboarding_state, created_at, updated_at)
  VALUES ('subject-a', 'subject-a', 'wallet_ready', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');
  INSERT INTO wallet_references (wallet_reference, subject_reference, provider, address, chain_family, control_model, observed_at)
  VALUES ('wallet-a', 'subject-a', 'privy', '0x1111111111111111111111111111111111111111', 'evm', 'customer', '2026-09-23T00:00:00.000Z');
  INSERT INTO transaction_intents (intent_id, subject_reference, wallet_reference, intent_type, chain_id, request_json,
    policy_result_json, disclosure_version, status, created_at, updated_at, expires_at)
  VALUES ('intent-1', 'subject-a', 'wallet-a', 'transfer', 8453, '{}', '{}', 'v1', 'reviewed',
    '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z', '2026-09-23T00:05:00.000Z');`;
const challenge = `INSERT INTO action_passkey_challenges
  (challenge_id, challenge_digest, subject_reference, session_reference, purpose, intent_id, step_index, call_fingerprint,
   policy_version, rp_id, origin, expires_at, created_at)
  VALUES ('challenge-1', 'sha256:one', 'subject-a', 'session-a', 'intent_step', 'intent-1', 0, 'sha256:call',
    1, 'app.aurel.test', 'https://app.aurel.test', '2026-09-23T00:05:00.000Z', '2026-09-23T00:00:00.000Z');`;

function run(sql: string) {
  const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  const migrations = files.map((name) => readFileSync(resolve(directory, name), "utf8")).join("\n");
  return spawnSync("sqlite3", [":memory:"], { input: `PRAGMA foreign_keys = ON;\n${migrations}\n${subject}\n${sql}`, encoding: "utf8" });
}

describe("action-passkey evidence migration", () => {
  it("adds durable credential, challenge and authorization records with a versioned policy", () => {
    const result = run(`INSERT INTO security_profiles (subject_reference, updated_at) VALUES ('subject-a', '2026-09-23T00:00:00.000Z');
      SELECT policy_version FROM security_profiles WHERE subject_reference = 'subject-a';
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
        ('action_passkey_credentials', 'action_passkey_challenges', 'action_passkey_authorizations') ORDER BY name;`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("1\naction_passkey_authorizations\naction_passkey_challenges\naction_passkey_credentials");
  });

  it("keeps a new credential pending and forbids an empty key", () => {
    const good = run(`INSERT INTO action_passkey_credentials
      (credential_id, subject_reference, public_key_cose, algorithm, rp_id, created_at)
      VALUES ('credential-1', 'subject-a', X'A101', -7, 'app.aurel.test', '2026-09-23T00:00:00.000Z');
      SELECT status FROM action_passkey_credentials WHERE credential_id = 'credential-1';`);
    expect(good.status, good.stderr).toBe(0);
    expect(good.stdout.trim()).toBe("pending");
    const empty = run(`INSERT INTO action_passkey_credentials
      (credential_id, subject_reference, public_key_cose, algorithm, rp_id, created_at)
      VALUES ('credential-1', 'subject-a', X'', -7, 'app.aurel.test', '2026-09-23T00:00:00.000Z');`);
    expect(empty.status).not.toBe(0);
  });

  it("requires an exact action binding and forbids challenge rebinding or resurrection", () => {
    const unbound = run(challenge.replace("'sha256:call'", "NULL"));
    expect(unbound.status).not.toBe(0);
    const rebound = run(`${challenge} UPDATE action_passkey_challenges SET call_fingerprint = 'sha256:other' WHERE challenge_id = 'challenge-1';`);
    expect(rebound.status).not.toBe(0);
    const reused = run(`${challenge}
      UPDATE action_passkey_challenges SET consumed_at = '2026-09-23T00:01:00.000Z' WHERE challenge_id = 'challenge-1';
      UPDATE action_passkey_challenges SET consumed_at = NULL WHERE challenge_id = 'challenge-1';`);
    expect(reused.status).not.toBe(0);
    for (const consumedAt of ["", "2026-09-22T23:59:59.000Z", "2026-09-23T00:06:00.000Z"]) {
      const invalidTime = run(`${challenge} UPDATE action_passkey_challenges SET consumed_at = '${consumedAt}' WHERE challenge_id = 'challenge-1';`);
      expect(invalidTime.status, consumedAt).not.toBe(0);
    }
  });

  it("records only one immutable authorization per consumed challenge", () => {
    const sql = `${challenge}
      INSERT INTO action_passkey_credentials
        (credential_id, subject_reference, public_key_cose, algorithm, rp_id, status, created_at, activated_at)
        VALUES ('credential-1', 'subject-a', X'A101', -7, 'app.aurel.test', 'active', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');
      UPDATE action_passkey_challenges SET consumed_at = '2026-09-23T00:01:00.000Z' WHERE challenge_id = 'challenge-1';
      INSERT INTO action_passkey_authorizations
        (authorization_id, challenge_id, credential_id, subject_reference, purpose, intent_id, step_index,
         call_fingerprint, policy_version, authorized_at, expires_at)
        VALUES ('auth-1', 'challenge-1', 'credential-1', 'subject-a', 'intent_step', 'intent-1', 0,
          'sha256:call', 1, '2026-09-23T00:01:00.000Z', '2026-09-23T00:03:00.000Z');`;
    const good = run(`${sql} SELECT COUNT(*) FROM action_passkey_authorizations;`);
    expect(good.status, good.stderr).toBe(0);
    expect(good.stdout.trim()).toBe("1");
    const duplicate = run(`${sql} INSERT INTO action_passkey_authorizations
      (authorization_id, challenge_id, credential_id, subject_reference, purpose, intent_id, step_index,
       call_fingerprint, policy_version, authorized_at, expires_at)
      VALUES ('auth-2', 'challenge-1', 'credential-1', 'subject-a', 'intent_step', 'intent-1', 0,
        'sha256:call', 1, '2026-09-23T00:02:00.000Z', '2026-09-23T00:03:00.000Z');`);
    expect(duplicate.status).not.toBe(0);
    const overlong = run(sql.replace("'2026-09-23T00:03:00.000Z'", "'2026-09-23T00:06:00.000Z'"));
    expect(overlong.status).not.toBe(0);
    const backdated = run(sql.replace("SET consumed_at = '2026-09-23T00:01:00.000Z'", "SET consumed_at = '2026-09-23T00:02:00.000Z'"));
    expect(backdated.status).not.toBe(0);
    const changed = run(`${sql} UPDATE action_passkey_authorizations SET call_fingerprint = 'sha256:other' WHERE authorization_id = 'auth-1';`);
    expect(changed.status).not.toBe(0);
  });
});
