import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { issueActionPasskeyChallenge } from "@/lib/security/action-passkey-challenge";

const root = resolve(process.cwd(), "../../infra/d1/migrations");
const at = new Date("2026-09-23T00:01:00.000Z");
const input = {
  subjectReference: "subject-a", sessionReference: "session-a", intentId: "intent-1",
  stepIndex: 0, callFingerprint: "sha256:call", policyVersion: 1,
  origin: "https://app.aurel.test", rpId: "app.aurel.test", deploymentMode: "development" as const, now: at,
};

let sqlite: DatabaseSync;
let database: D1Database;

function d1(connection: DatabaseSync): D1Database {
  return { prepare(sql: string) {
    let values: unknown[] = [];
    return { bind(...bound: unknown[]) { values = bound; return this; },
      async run() {
        const result = connection.prepare(sql).run(...values as Array<string | number | null>);
        return { meta: { changes: Number(result.changes) } };
      },
      async first<T>() { return connection.prepare(sql).get(...values as Array<string | number | null>) as T | null; } };
  } } as unknown as D1Database;
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(root).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(resolve(root, file), "utf8"));
  }
  sqlite.exec("UPDATE feature_flags SET enabled=1 WHERE flag_key='direct_transfers'");
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, onboarding_state, created_at, updated_at)
      VALUES ('subject-a', 'subject-a', 'wallet_ready', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');
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
    INSERT INTO address_book_entries (entry_id, subject_reference, chain_family, address, label, created_at, available_at)
      VALUES ('recipient-1', 'subject-a', 'evm', '0x2222222222222222222222222222222222222222', 'Recipient',
        '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');
    INSERT INTO intent_valuations (valuation_id, intent_id, asset_id, raw_units, decimals, price_usd,
      market_price_usd, price_source, price_observed_at, valued_at, usd_cents, policy_version, depeg_uncertainty)
      VALUES ('valuation-1', 'intent-1', '8453:native', '1', 18, '100', '100', 'kraken:ohlc:1m:ETH/USD:high',
        '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z', '10000', 1, 0);
    INSERT INTO action_passkey_credentials (credential_id, subject_reference, public_key_cose, algorithm, rp_id,
      sign_count, status, created_at, activated_at) VALUES ('credential-1', 'subject-a', X'A101', -7,
        'app.aurel.test', 1, 'active', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');`);
  database = d1(sqlite);
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); });

describe("disconnected action passkey challenge issuance", () => {
  it("does not issue a step-up challenge for an ordinary legacy call", async () => {
    sqlite.exec("DROP TRIGGER intent_prepared_calls_step_up_hold; UPDATE intent_prepared_calls SET submission_phase='legacy' WHERE intent_id='intent-1'");
    await expect(issueActionPasskeyChallenge(database, input)).rejects.toThrow();
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM action_passkey_challenges").get() as { n: number }).n).toBe(0);
  });

  it("stores only a digest of a random 32-byte challenge and exact action binding", async () => {
    const result = await issueActionPasskeyChallenge(database, input);
    expect(result.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(result.challenge));
    const expectedDigest = `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    expect(sqlite.prepare("SELECT challenge_digest, subject_reference, session_reference, intent_id, step_index, call_fingerprint, policy_version, origin, rp_id, purpose, expires_at FROM action_passkey_challenges").get()).toMatchObject({
      challenge_digest: expectedDigest, subject_reference: "subject-a", session_reference: "session-a",
      intent_id: "intent-1", step_index: 0, call_fingerprint: "sha256:call", policy_version: 1,
      origin: input.origin, rp_id: input.rpId, purpose: "intent_step", expires_at: result.expiresAt,
    });
    expect(result.expiresAt).toBe("2026-09-23T00:03:00.000Z");
    expect((await issueActionPasskeyChallenge(database, input)).challenge).not.toBe(result.challenge);
  });

  it.each([
    ["subject", { subjectReference: "subject-b" }], ["session", { sessionReference: "" }],
    ["intent", { intentId: "intent-2" }], ["step", { stepIndex: 1 }],
    ["fingerprint", { callFingerprint: "sha256:other" }], ["policy", { policyVersion: 2 }],
    ["origin", { origin: "https://evil.example" }], ["RP", { rpId: "evil.example" }],
    ["shared RP", { origin: "https://workers.dev", rpId: "workers.dev" }],
  ])("rejects invalid %s binding", async (_label, change) => {
    await expect(issueActionPasskeyChallenge(database, { ...input, ...change })).rejects.toThrow();
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM action_passkey_challenges").get() as { n: number }).n).toBe(0);
  });

  it.each([
    ["account lock", "UPDATE security_profiles SET account_locked=1 WHERE subject_reference='subject-a'"],
    ["policy change", "UPDATE security_profiles SET policy_version=2 WHERE subject_reference='subject-a'"],
    ["revoked credential", "UPDATE action_passkey_credentials SET status='revoked', revoked_at='2026-09-23T00:00:30.000Z' WHERE credential_id='credential-1'"],
    ["disabled transfer", "UPDATE feature_flags SET enabled=0 WHERE flag_key='direct_transfers'"],
    ["recipient cooling", "UPDATE address_book_entries SET available_at='2026-09-23T00:02:00.000Z' WHERE entry_id='recipient-1'"],
    ["cancelled intent", "UPDATE transaction_intents SET status='cancelled' WHERE intent_id='intent-1'"],
    ["foreign intent wallet", `INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
      VALUES ('subject-b','subject-b','2026-09-23T00:00:00.000Z','2026-09-23T00:00:00.000Z');
      UPDATE wallet_references SET subject_reference='subject-b' WHERE wallet_reference='wallet-a'`],
    ["non-EVM intent wallet", "UPDATE wallet_references SET chain_family='solana' WHERE wallet_reference='wallet-a'"],
    ["different prepared wallet", "UPDATE intent_prepared_calls SET wallet_address='0x3333333333333333333333333333333333333333' WHERE intent_id='intent-1'"],
    ["expired intent", "UPDATE transaction_intents SET expires_at='2026-09-23T00:00:30.000Z' WHERE intent_id='intent-1'"],
    ["expired prepared call", "UPDATE intent_prepared_calls SET expires_at='2026-09-23T00:00:30.000Z' WHERE intent_id='intent-1'"],
    ["changed prepared call", "UPDATE intent_prepared_calls SET call_fingerprint='sha256:other' WHERE intent_id='intent-1'"],
    ["stale valuation", "UPDATE intent_valuations SET valued_at='2026-09-22T23:50:00.000Z' WHERE intent_id='intent-1'"],
    ["stale market price", "UPDATE intent_valuations SET price_observed_at='2026-09-22T23:50:00.000Z' WHERE intent_id='intent-1'"],
    ["changed valued amount", "UPDATE intent_valuations SET raw_units='2' WHERE intent_id='intent-1'"],
    ["reduced daily cap", "UPDATE security_profiles SET daily_limit_usd=50 WHERE subject_reference='subject-a'"],
    ["no active passkey", "UPDATE action_passkey_credentials SET status='pending' WHERE credential_id='credential-1'"],
  ])("rejects %s before challenge exists", async (_label, mutation) => {
    sqlite.exec("DROP TRIGGER IF EXISTS intent_prepared_calls_immutable_update; DROP TRIGGER IF EXISTS intent_prepared_calls_step_up_hold; DROP TRIGGER IF EXISTS intent_valuations_no_update;");
    sqlite.exec(mutation);
    await expect(issueActionPasskeyChallenge(database, input)).rejects.toThrow();
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM action_passkey_challenges").get() as { n: number }).n).toBe(0);
  });

  it("fails with a non-HTTPS production configuration", async () => {
    await expect(issueActionPasskeyChallenge(database, { ...input, origin: "http://app.aurel.test" })).rejects.toThrow();
  });

  it("rejects a Worker host in production before writing a challenge", async () => {
    const host = "aurel-financial-os.aurel-events.workers.dev";
    await expect(issueActionPasskeyChallenge(database, { ...input, origin: `https://${host}`, rpId: host, deploymentMode: "production" })).rejects.toThrow(/origin/i);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM action_passkey_challenges").get() as { n: number }).n).toBe(0);
  });

  it("expires no later than the reviewed call", async () => {
    sqlite.exec("DROP TRIGGER IF EXISTS intent_prepared_calls_immutable_update; DROP TRIGGER IF EXISTS intent_prepared_calls_step_up_hold");
    sqlite.exec("UPDATE intent_prepared_calls SET expires_at='2026-09-23T00:01:30.000Z' WHERE intent_id='intent-1'");
    const result = await issueActionPasskeyChallenge(database, input);
    expect(result.expiresAt).toBe("2026-09-23T00:01:30.000Z");
  });
});
