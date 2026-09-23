import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { storePendingActionPasskeyRegistration, type VerifiedPendingRegistration } from "@/lib/security/action-passkey-registration";

const root = resolve(process.cwd(), "../../infra/d1/migrations");
const at = new Date("2026-09-23T00:01:00.000Z");
const digest = `sha256:${"a".repeat(64)}`;
const verified = {
  credentialId: "Y3JlZGVudGlhbC0x", subjectReference: "subject-a", publicKeyCose: new Uint8Array([0xa1, 0x03, 0x26]),
  algorithm: -7, counter: 0, origin: "https://app.aurel.test", rpId: "app.aurel.test", challengeDigest: digest
} as VerifiedPendingRegistration;
const input = { challengeId: "challenge-1", subjectReference: "subject-a", sessionReference: "session-a",
  origin: "https://app.aurel.test", rpId: "app.aurel.test", deploymentMode: "development" as const, now: at, verified };
let sqlite: DatabaseSync;
let database: D1Database;

function d1(connection: DatabaseSync): D1Database {
  let pending = Promise.resolve();
  const prepare = (sql: string) => ({ bind(...values: unknown[]) {
    const statement = connection.prepare(sql);
    return { async run() { const result = statement.run(...values as Array<string | number | Uint8Array | null>); return { meta: { changes: Number(result.changes) } }; } };
  } });
  return { prepare, batch(statements: Array<{ run(): Promise<unknown> }>) {
    const operation = pending.then(async () => {
      connection.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        connection.exec("COMMIT");
        return results;
      } catch (error) { connection.exec("ROLLBACK"); throw error; }
    });
    pending = operation.then(() => undefined, () => undefined);
    return operation;
  } } as unknown as D1Database;
}

beforeEach(() => {
  vi.stubEnv("BETA_ALLOWED_COUNTRIES", "PT");
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(root).filter((name) => name.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(resolve(root, file), "utf8"));
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
      VALUES ('subject-a','subject-a','2026-09-23T00:00:00.000Z','2026-09-23T00:00:00.000Z');
    INSERT INTO security_profiles (subject_reference, updated_at)
      VALUES ('subject-a','2026-09-23T00:00:00.000Z');
    INSERT INTO beta_access (subject_reference, cohort, country_code, status, transaction_limit_usd, terms_version, terms_accepted_at, activated_at, updated_at)
      VALUES ('subject-a','test','PT','active',25000,'v1','2026-09-23T00:00:00.000Z','2026-09-23T00:00:00.000Z','2026-09-23T00:00:00.000Z');
    INSERT INTO action_passkey_challenges (challenge_id, challenge_digest, subject_reference, session_reference, purpose, rp_id, origin, expires_at, created_at)
      VALUES ('challenge-1','${digest}','subject-a','session-a','registration','app.aurel.test','https://app.aurel.test','2026-09-23T00:05:00.000Z','2026-09-23T00:00:00.000Z');`);
  database = d1(sqlite);
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); });

const count = () => (sqlite.prepare("SELECT COUNT(*) AS count FROM action_passkey_credentials").get() as { count: number }).count;
const consumed = () => (sqlite.prepare("SELECT consumed_at FROM action_passkey_challenges WHERE challenge_id='challenge-1'").get() as { consumed_at: string | null }).consumed_at;

describe("pending action passkey registration store", () => {
  it("consumes once and records a pending credential with an audit event", async () => {
    await storePendingActionPasskeyRegistration(database, input);
    expect(consumed()).toBe(at.toISOString());
    expect(sqlite.prepare("SELECT credential_id, subject_reference, algorithm, rp_id, status, activated_at, sign_count FROM action_passkey_credentials").get())
      .toMatchObject({ credential_id: verified.credentialId, subject_reference: "subject-a", algorithm: -7, rp_id: input.rpId,
        status: "pending", activated_at: null, sign_count: 0 });
    const key = sqlite.prepare("SELECT public_key_cose FROM action_passkey_credentials").get() as { public_key_cose: Uint8Array };
    expect(Array.from(key.public_key_cose)).toEqual(Array.from(verified.publicKeyCose));
    expect(sqlite.prepare("SELECT action, target_reference FROM audit_events").get())
      .toMatchObject({ action: "action_passkey_registration_pending", target_reference: verified.credentialId });
    await expect(storePendingActionPasskeyRegistration(database, input)).rejects.toThrow();
    expect(count()).toBe(1);
  });

  it.each([
    ["wrong subject", { subjectReference: "subject-b" }],
    ["wrong session", { sessionReference: "session-b" }],
    ["wrong digest", { verified: { ...verified, challengeDigest: `sha256:${"b".repeat(64)}` } }],
    ["wrong origin", { origin: "https://evil.example" }],
    ["wrong RP", { rpId: "evil.example" }],
    ["expired", { now: new Date("2026-09-23T00:05:00.000Z") }]
  ])("rejects %s without consuming", async (_name, change) => {
    await expect(storePendingActionPasskeyRegistration(database, { ...input, ...change })).rejects.toThrow();
    expect(consumed()).toBeNull();
    expect(count()).toBe(0);
  });

  it("rechecks lock, beta, and country at consumption", async () => {
    sqlite.exec("UPDATE security_profiles SET account_locked=1");
    await expect(storePendingActionPasskeyRegistration(database, input)).rejects.toThrow();
    sqlite.exec("UPDATE security_profiles SET account_locked=0; UPDATE beta_access SET status='suspended'");
    await expect(storePendingActionPasskeyRegistration(database, input)).rejects.toThrow();
    sqlite.exec("UPDATE beta_access SET status='active', country_code='US'");
    await expect(storePendingActionPasskeyRegistration(database, input)).rejects.toThrow();
    expect(consumed()).toBeNull();
  });

  it("rolls back consumption if the credential ID already exists", async () => {
    sqlite.prepare(`INSERT INTO action_passkey_credentials (credential_id,subject_reference,public_key_cose,algorithm,rp_id,created_at)
      VALUES (?,'subject-a',X'A101',-7,'app.aurel.test','2026-09-23T00:00:00.000Z')`).run(verified.credentialId);
    await expect(storePendingActionPasskeyRegistration(database, input)).rejects.toThrow();
    expect(consumed()).toBeNull();
    expect(count()).toBe(1);
  });

  it("lets only one of two concurrent consumers win", async () => {
    const results = await Promise.allSettled([storePendingActionPasskeyRegistration(database, input), storePendingActionPasskeyRegistration(database, input)]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(count()).toBe(1);
  });
});
