import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { consumeVerifiedActionPasskey } from "@/lib/security/action-passkey-store";

const at = "2026-09-23T00:01:00.000Z";
const root = resolve(process.cwd(), "../../infra/d1/migrations");
const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const base = {
  challengeId: "challenge-1", challengeDigest: digestA, subjectReference: "subject-a",
  sessionReference: "session-a", intentId: "intent-1", stepIndex: 0,
  callFingerprint: "sha256:call", policyVersion: 1, rpId: "app.aurel.test",
  origin: "https://app.aurel.test", now: new Date(at),
  verified: { credentialId: "credential-1", newCounter: 2, rpId: "app.aurel.test", origin: "https://app.aurel.test", challengeDigest: digestA }
} as unknown as Parameters<typeof consumeVerifiedActionPasskey>[1];

function d1(sqlite: DatabaseSync): D1Database {
  let pending = Promise.resolve();
  const prepare = (sql: string) => ({ bind(...values: unknown[]) {
    const statement = sqlite.prepare(sql);
    return { async run() {
      const result = statement.run(...values as Array<string | number | null>);
      return { meta: { changes: Number(result.changes) } };
    } };
  } });
  return { prepare, batch(statements: Array<{ run(): Promise<unknown> }>) {
    const operation = pending.then(async () => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    });
    pending = operation.then(() => undefined, () => undefined);
    return operation;
  } } as unknown as D1Database;
}

let sqlite: DatabaseSync;
let database: D1Database;
const count = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM action_passkey_authorizations").get() as { n: number }).n;
const challenge = () => sqlite.prepare("SELECT consumed_at FROM action_passkey_challenges WHERE challenge_id = 'challenge-1'").get() as { consumed_at: string | null };
const counter = () => sqlite.prepare("SELECT sign_count FROM action_passkey_credentials WHERE credential_id = 'credential-1'").get() as { sign_count: number };

beforeEach(() => {
  vi.stubEnv("BETA_ALLOWED_COUNTRIES", "PT");
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(root).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(resolve(root, file), "utf8"));
  }
  sqlite.exec("UPDATE feature_flags SET enabled=1 WHERE flag_key='direct_transfers'");
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, onboarding_state, created_at, updated_at)
      VALUES ('subject-a', 'subject-a', 'beta_active', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');
    INSERT INTO wallet_references (wallet_reference, subject_reference, provider, address, chain_family, control_model, observed_at)
      VALUES ('wallet-a', 'subject-a', 'privy', '0x1111111111111111111111111111111111111111', 'evm', 'customer', '2026-09-23T00:00:00.000Z');
    INSERT INTO transaction_intents (intent_id, subject_reference, wallet_reference, intent_type, chain_id, request_json,
      policy_result_json, disclosure_version, status, created_at, updated_at, expires_at)
      VALUES ('intent-1', 'subject-a', 'wallet-a', 'transfer', 8453,
        '{"type":"transfer","destination":"0x2222222222222222222222222222222222222222"}',
        '{"permitted":true}', 'v1', 'reviewed',
        '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z', '2026-09-23T00:05:00.000Z');
    INSERT INTO intent_prepared_calls (intent_id, step_index, subject_reference, wallet_address, chain_id, target_address,
      native_value, calldata_hash, call_fingerprint, semantic_action, source_reference, expires_at,
      expected_effect_json, created_at, submission_phase)
      VALUES ('intent-1', 0, 'subject-a', '0x1111111111111111111111111111111111111111', 8453,
        '0x2222222222222222222222222222222222222222', '0', 'sha256:calldata', 'sha256:call',
        'native_transfer', 'source-1', '2026-09-23T00:04:00.000Z',
        '{"type":"native_transfer","recipient":"0x2222222222222222222222222222222222222222","amountRaw":"1"}',
        '2026-09-23T00:00:00.000Z', 'awaiting_step_up');
    INSERT INTO security_profiles (subject_reference, updated_at) VALUES ('subject-a', '2026-09-23T00:00:00.000Z');
    INSERT INTO beta_access (subject_reference, cohort, country_code, status, transaction_limit_usd,
      terms_version, terms_accepted_at, activated_at, updated_at)
      VALUES ('subject-a', 'test', 'PT', 'active', 25000, 'private-beta-2026-09',
        '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');
    INSERT INTO address_book_entries (entry_id, subject_reference, chain_family, address, label, created_at, available_at)
      VALUES ('recipient-1', 'subject-a', 'evm', '0x2222222222222222222222222222222222222222', 'Recipient',
        '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');
    INSERT INTO intent_valuations (valuation_id, intent_id, asset_id, raw_units, decimals, price_usd,
      market_price_usd, price_source, price_observed_at, valued_at, usd_cents, policy_version, depeg_uncertainty)
      VALUES ('valuation-1', 'intent-1', '8453:native', '1', 18, '100', '100', 'kraken:ohlc:1m:ETH/USD:high',
        '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z', '10000', 1, 0);
    INSERT INTO action_passkey_credentials (credential_id, subject_reference, public_key_cose, algorithm, rp_id,
      sign_count, status, created_at, activated_at) VALUES ('credential-1', 'subject-a', X'A101', -7,
        'app.aurel.test', 1, 'active', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');
    INSERT INTO action_passkey_challenges (challenge_id, challenge_digest, subject_reference, session_reference,
      purpose, intent_id, step_index, call_fingerprint, policy_version, rp_id, origin, expires_at, created_at)
      VALUES ('challenge-1', '${digestA}', 'subject-a', 'session-a', 'intent_step', 'intent-1', 0,
        'sha256:call', 1, 'app.aurel.test', 'https://app.aurel.test', '2026-09-23T00:03:00.000Z',
        '2026-09-23T00:00:00.000Z');`);
  database = d1(sqlite);
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); });

describe("action passkey evidence store", () => {
  it("does not consume an assertion for an ordinary legacy call", async () => {
    sqlite.exec("DROP TRIGGER intent_prepared_calls_step_up_hold; UPDATE intent_prepared_calls SET submission_phase='legacy' WHERE intent_id='intent-1'");
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
  });

  it("consumes exactly one matching challenge and records authorization with the verified counter", async () => {
    const result = await consumeVerifiedActionPasskey(database, base);
    expect(result.authorizationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(count()).toBe(1);
    expect(challenge().consumed_at).toBe(at);
    expect(counter().sign_count).toBe(2);
    expect(sqlite.prepare("SELECT call_fingerprint,policy_version,credential_id,expires_at FROM action_passkey_authorizations").get())
      .toMatchObject({ call_fingerprint: "sha256:call", policy_version: 1, credential_id: "credential-1", expires_at: "2026-09-23T00:03:00.000Z" });
  });

  it("rejects replay and two simultaneous consumers without a second authorization", async () => {
    const settled = await Promise.allSettled([
      consumeVerifiedActionPasskey(database, base), consumeVerifiedActionPasskey(database, base)
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(count()).toBe(1);
    expect(counter().sign_count).toBe(2);
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(1);
  });

  it("rolls back challenge consumption when the credential update loses its condition", async () => {
    sqlite.exec(`CREATE TRIGGER advance_credential_during_consume
      AFTER UPDATE OF consumed_at ON action_passkey_challenges
      BEGIN UPDATE action_passkey_credentials SET sign_count=3 WHERE credential_id='credential-1'; END;`);
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
    expect(counter().sign_count).toBe(1);
  });

  it("cannot use a verified assertion for challenge A to consume challenge B", async () => {
    sqlite.prepare(`INSERT INTO action_passkey_challenges (challenge_id,challenge_digest,subject_reference,session_reference,
      purpose,intent_id,step_index,call_fingerprint,policy_version,rp_id,origin,expires_at,created_at)
      VALUES ('challenge-2',?,'subject-a','session-a','intent_step','intent-1',0,'sha256:call',1,
        'app.aurel.test','https://app.aurel.test','2026-09-23T00:03:00.000Z','2026-09-23T00:00:00.000Z')`).run(digestB);
    await expect(consumeVerifiedActionPasskey(database, { ...base, challengeId: "challenge-2", challengeDigest: digestB })).rejects.toThrow();
    expect(count()).toBe(0);
    expect((sqlite.prepare("SELECT consumed_at FROM action_passkey_challenges WHERE challenge_id='challenge-2'").get() as { consumed_at: string | null }).consumed_at).toBeNull();
  });

  it.each([
    ["call", "UPDATE intent_prepared_calls SET expires_at='2026-09-23T00:02:00.000Z' WHERE intent_id='intent-1'", "2026-09-23T00:02:00.000Z"],
    ["intent", "UPDATE transaction_intents SET expires_at='2026-09-23T00:01:30.000Z' WHERE intent_id='intent-1'", "2026-09-23T00:01:30.000Z"]
  ])("ends authorization when the reviewed %s expires first", async (_source, mutation, expected) => {
    // Build a shorter-lived preexisting record; production prepared calls are immutable after creation.
    sqlite.exec("DROP TRIGGER intent_prepared_calls_immutable_update; DROP TRIGGER intent_prepared_calls_step_up_hold");
    sqlite.exec(mutation);
    await consumeVerifiedActionPasskey(database, base);
    expect(sqlite.prepare("SELECT expires_at FROM action_passkey_authorizations").get())
      .toMatchObject({ expires_at: expected });
  });

  it.each([
    ["subject", { subjectReference: "subject-b" }],
    ["session", { sessionReference: "session-b" }],
    ["challenge digest", { challengeDigest: "sha256:other" }],
    ["intent", { intentId: "intent-2" }],
    ["step", { stepIndex: 1 }],
    ["call", { callFingerprint: "sha256:other" }],
    ["policy version", { policyVersion: 2 }],
    ["origin", { origin: "https://evil.example" }],
    ["RP ID", { rpId: "evil.example" }],
    ["verified origin", { verified: { ...base.verified, origin: "https://evil.example" } }],
    ["verified RP ID", { verified: { ...base.verified, rpId: "evil.example" } }],
    ["expired time", { now: new Date("2026-09-23T00:03:00.000Z") }],
    ["before issuance", { now: new Date("2026-09-22T23:59:59.000Z") }],
    ["regressed counter", { verified: { ...base.verified, newCounter: 1 } }]
  ])("rejects changed %s without consuming or authorizing", async (_label, change) => {
    await expect(consumeVerifiedActionPasskey(database, { ...base, ...change } as Parameters<typeof consumeVerifiedActionPasskey>[1])).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
    expect(counter().sign_count).toBe(1);
  });

  it.each([
    ["revoked credential", "UPDATE action_passkey_credentials SET status='revoked', revoked_at='2026-09-23T00:00:30.000Z' WHERE credential_id='credential-1'"],
    ["account lock", "UPDATE security_profiles SET account_locked=1 WHERE subject_reference='subject-a'"],
    ["changed policy", "UPDATE security_profiles SET policy_version=2 WHERE subject_reference='subject-a'"],
    ["expired prepared call", "UPDATE intent_prepared_calls SET expires_at='2026-09-23T00:00:30.000Z' WHERE intent_id='intent-1'"],
    ["changed prepared call", "UPDATE intent_prepared_calls SET call_fingerprint='sha256:other' WHERE intent_id='intent-1'"],
    ["missing prepared call", "DELETE FROM intent_prepared_calls WHERE intent_id='intent-1'"],
    ["cancelled intent", "UPDATE transaction_intents SET status='cancelled' WHERE intent_id='intent-1'"],
    ["wrong purpose", "UPDATE action_passkey_challenges SET purpose='policy_change', proposed_diff_digest='sha256:diff' WHERE challenge_id='challenge-1'"]
  ])("rejects %s without authorization", async (_label, mutation) => {
    if (_label === "changed prepared call" || _label === "expired prepared call" || _label === "missing prepared call" || _label === "wrong purpose") {
      // Immutable production evidence cannot be rebound; simulate a different preexisting record instead.
      sqlite.exec("PRAGMA foreign_keys=OFF");
      sqlite.exec("DROP TRIGGER IF EXISTS intent_prepared_calls_immutable_update; DROP TRIGGER IF EXISTS intent_prepared_calls_step_up_hold; DROP TRIGGER IF EXISTS intent_prepared_calls_no_delete; DROP TRIGGER IF EXISTS action_passkey_challenges_protect;");
    }
    sqlite.exec(mutation);
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
  });

  it.each([
    ["suspended beta", "UPDATE beta_access SET status='suspended' WHERE subject_reference='subject-a'"],
    ["closed beta", "UPDATE beta_access SET status='closed' WHERE subject_reference='subject-a'"],
    ["changed country", "UPDATE beta_access SET country_code='US' WHERE subject_reference='subject-a'"],
    ["missing beta", "DELETE FROM beta_access WHERE subject_reference='subject-a'"],
    ["disabled direct transfers", "UPDATE feature_flags SET enabled=0 WHERE flag_key='direct_transfers'"],
    ["operations-only direct transfers", "UPDATE feature_flags SET audience='operations' WHERE flag_key='direct_transfers'"],
    ["missing direct-transfer flag", "DELETE FROM feature_flags WHERE flag_key='direct_transfers'"],
    ["recipient cooling", "UPDATE address_book_entries SET available_at='2026-09-23T00:02:00.000Z' WHERE entry_id='recipient-1'"],
    ["recipient removed", "DELETE FROM address_book_entries WHERE entry_id='recipient-1'"],
    ["changed action", "UPDATE transaction_intents SET intent_type='swap' WHERE intent_id='intent-1'"],
    ["revoked reviewed decision", `UPDATE transaction_intents SET policy_result_json='{"permitted":false}' WHERE intent_id='intent-1'`],
    ["changed reviewed recipient", `UPDATE transaction_intents SET request_json='{"type":"transfer","destination":"0x3333333333333333333333333333333333333333"}' WHERE intent_id='intent-1'`],
    ["changed reviewed chain", "UPDATE transaction_intents SET chain_id=1 WHERE intent_id='intent-1'"],
    ["changed linked wallet address", "UPDATE wallet_references SET address='0x3333333333333333333333333333333333333333' WHERE wallet_reference='wallet-a'"],
    ["changed linked wallet family", "UPDATE wallet_references SET chain_family='solana' WHERE wallet_reference='wallet-a'"],
    ["both intent and call moved to another chain", "UPDATE transaction_intents SET chain_id=1 WHERE intent_id='intent-1'; UPDATE intent_prepared_calls SET chain_id=1 WHERE intent_id='intent-1'"],
    ["new review delay", "UPDATE transaction_intents SET release_at='2026-09-23T00:02:00.000Z' WHERE intent_id='intent-1'"]
  ])("rejects current %s before consuming the assertion", async (_label, mutation) => {
    if (_label === "both intent and call moved to another chain") sqlite.exec("DROP TRIGGER intent_prepared_calls_immutable_update; DROP TRIGGER intent_prepared_calls_step_up_hold");
    sqlite.exec(mutation);
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
    expect(counter().sign_count).toBe(1);
  });

  it("rejects when the launch-country allowlist is not configured", async () => {
    vi.stubEnv("BETA_ALLOWED_COUNTRIES", "");
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
  });

  it.each([
    ["beta cap", "UPDATE beta_access SET transaction_limit_usd=50 WHERE subject_reference='subject-a'"],
    ["security cap", "UPDATE security_profiles SET daily_limit_usd=50 WHERE subject_reference='subject-a'"]
  ])("rejects a reduced %s even if the challenge and policy version still match", async (_label, mutation) => {
    sqlite.exec(mutation);
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
  });

  it("rejects intervening prepared spend that exhausts the rolling limit", async () => {
    sqlite.exec(`UPDATE security_profiles SET daily_limit_usd=150 WHERE subject_reference='subject-a';
      INSERT INTO transaction_intents (intent_id, subject_reference, wallet_reference, intent_type, chain_id,
        request_json, policy_result_json, disclosure_version, status, created_at, updated_at, expires_at)
      VALUES ('intent-2', 'subject-a', 'wallet-a', 'transfer', 8453, '{}', '{}', 'v1', 'reviewed',
        '2026-09-23T00:00:30.000Z', '2026-09-23T00:00:30.000Z', '2026-09-23T00:05:00.000Z');
      INSERT INTO intent_valuations (valuation_id, intent_id, asset_id, raw_units, decimals, price_usd,
        market_price_usd, price_source, price_observed_at, valued_at, usd_cents, policy_version, depeg_uncertainty)
      VALUES ('valuation-2', 'intent-2', '8453:native', '1', 18, '60', '60', 'kraken:ohlc:1m:ETH/USD:high',
        '2026-09-23T00:00:30.000Z', '2026-09-23T00:00:30.000Z', '6000', 1, 0);
      INSERT INTO intent_prepared_calls (intent_id, step_index, subject_reference, wallet_address, chain_id,
        target_address, native_value, calldata_hash, call_fingerprint, semantic_action, source_reference,
        expires_at, expected_effect_json, created_at, submission_phase)
      VALUES ('intent-2', 0, 'subject-a', '0x1111111111111111111111111111111111111111', 8453,
        '0x2222222222222222222222222222222222222222', '0', 'sha256:other', 'sha256:other',
        'native_transfer', 'source-2', '2026-09-23T00:04:00.000Z', '{}', '2026-09-23T00:00:30.000Z', 'legacy');`);
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
  });

  it.each([
    ["missing current valuation", "DELETE FROM intent_valuations WHERE intent_id='intent-1'"],
    ["stale current valuation", "UPDATE intent_valuations SET price_observed_at='2026-09-22T23:50:00.000Z' WHERE intent_id='intent-1'"],
    ["stale valuation decision", "UPDATE intent_valuations SET valued_at='2026-09-22T23:50:00.000Z' WHERE intent_id='intent-1'"],
    ["malformed current valuation", "UPDATE intent_valuations SET usd_cents='unknown' WHERE intent_id='intent-1'"]
  ])("rejects %s", async (_label, mutation) => {
    sqlite.exec("DROP TRIGGER IF EXISTS intent_valuations_no_update; DROP TRIGGER IF EXISTS intent_valuations_no_delete;");
    sqlite.exec(mutation);
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
  });

  it("rejects a later valuation for a different amount than the prepared transfer", async () => {
    sqlite.exec(`INSERT INTO intent_valuations (valuation_id, intent_id, asset_id, raw_units, decimals, price_usd,
      market_price_usd, price_source, price_observed_at, valued_at, usd_cents, policy_version, depeg_uncertainty)
      VALUES ('valuation-2', 'intent-1', '8453:native', '2', 18, '100', '100', 'kraken:ohlc:1m:ETH/USD:high',
        '2026-09-23T00:00:30.000Z', '2026-09-23T00:00:30.000Z', '20000', 1, 0);`);
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
  });

  it("rejects a later valuation for a different asset than the prepared transfer", async () => {
    sqlite.exec(`INSERT INTO intent_valuations (valuation_id, intent_id, asset_id, raw_units, decimals, price_usd,
      market_price_usd, price_source, price_observed_at, valued_at, usd_cents, policy_version, depeg_uncertainty)
      VALUES ('valuation-2', 'intent-1', '8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '1', 6,
        '100', '100', 'kraken:ohlc:1m:ETH/USD:high', '2026-09-23T00:00:30.000Z',
        '2026-09-23T00:00:30.000Z', '10000', 1, 0);`);
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
  });

  it("rejects an unvalued recent prepared transfer rather than treating it as zero spend", async () => {
    sqlite.exec(`INSERT INTO transaction_intents (intent_id, subject_reference, wallet_reference, intent_type, chain_id,
      request_json, policy_result_json, disclosure_version, status, created_at, updated_at, expires_at)
      VALUES ('intent-2', 'subject-a', 'wallet-a', 'transfer', 8453, '{}', '{}', 'v1', 'reviewed',
        '2026-09-23T00:00:30.000Z', '2026-09-23T00:00:30.000Z', '2026-09-23T00:05:00.000Z');
      INSERT INTO intent_prepared_calls (intent_id, step_index, subject_reference, wallet_address, chain_id,
        target_address, native_value, calldata_hash, call_fingerprint, semantic_action, source_reference,
        expires_at, expected_effect_json, created_at, submission_phase)
      VALUES ('intent-2', 0, 'subject-a', '0x1111111111111111111111111111111111111111', 8453,
        '0x2222222222222222222222222222222222222222', '0', 'sha256:other', 'sha256:other',
        'native_transfer', 'source-2', '2026-09-23T00:04:00.000Z', '{}', '2026-09-23T00:00:30.000Z', 'legacy');`);
    await expect(consumeVerifiedActionPasskey(database, base)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(challenge().consumed_at).toBeNull();
  });
});
