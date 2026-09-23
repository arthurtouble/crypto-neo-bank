import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { issuePendingPasskeyPossessionChallenge, completePendingPasskeyPossession } from "@/lib/security/action-passkey-possession";

const root = resolve(process.cwd(), "../../infra/d1/migrations");
const origin = "https://app.aurel.test";
const rpId = "app.aurel.test";
const credentialId = Buffer.from("pending-credential").toString("base64url");
const now = new Date("2026-09-23T00:01:00.000Z");
const input = { subjectReference: "subject-a", sessionReference: "session-a", credentialId,
  origin, rpId, deploymentMode: "development" as const, now };
let sqlite: DatabaseSync;
let database: D1Database;
let privateKey: webcrypto.CryptoKey;
let publicKeyCose: Uint8Array;

function d1(connection: DatabaseSync): D1Database {
  let pending = Promise.resolve();
  const prepare = (sql: string) => {
    let values: unknown[] = [];
    return { bind(...bound: unknown[]) { values = bound; return this; },
      async run() { const result = connection.prepare(sql).run(...values as Array<string | number | Uint8Array | null>);
        return { meta: { changes: Number(result.changes) } }; },
      async first<T>() { return connection.prepare(sql).get(...values as Array<string | number | Uint8Array | null>) as T | null; } };
  };
  return { prepare, batch(statements: Array<{ run(): Promise<unknown> }>) {
    const operation = pending.then(async () => {
      connection.exec("BEGIN IMMEDIATE");
      try { const results = []; for (const statement of statements) results.push(await statement.run());
        connection.exec("COMMIT"); return results; }
      catch (error) { connection.exec("ROLLBACK"); throw error; }
    });
    pending = operation.then(() => undefined, () => undefined);
    return operation;
  } } as unknown as D1Database;
}

function derInteger(bytes: Uint8Array) {
  const first = bytes.findIndex((byte) => byte !== 0);
  const trimmed = bytes.subarray(first < 0 ? bytes.length - 1 : first);
  const value = trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : Buffer.from(trimmed);
  return Buffer.concat([Buffer.from([0x02, value.length]), value]);
}

async function assertion(challenge: string, changes: { origin?: string; rpId?: string; flags?: number;
  counter?: number; badSignature?: boolean } = {}): Promise<AuthenticationResponseJSON> {
  const authData = Buffer.alloc(37);
  Buffer.from(await webcrypto.subtle.digest("SHA-256", Buffer.from(changes.rpId ?? rpId))).copy(authData);
  authData[32] = changes.flags ?? 0x05;
  authData.writeUInt32BE(changes.counter ?? 1, 33);
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: changes.origin ?? origin }));
  const clientHash = Buffer.from(await webcrypto.subtle.digest("SHA-256", clientData));
  const signed = new Uint8Array(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey,
    Buffer.concat([authData, clientHash])));
  const r = derInteger(signed.subarray(0, 32));
  const s = derInteger(signed.subarray(32, 64));
  const signature = Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
  if (changes.badSignature) signature[signature.length - 1] ^= 1;
  return { id: credentialId, rawId: credentialId, type: "public-key", clientExtensionResults: {},
    response: { authenticatorData: authData.toString("base64url"), clientDataJSON: clientData.toString("base64url"),
      signature: signature.toString("base64url") } };
}

beforeEach(async () => {
  vi.stubEnv("BETA_ALLOWED_COUNTRIES", "PT");
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(root).filter((name) => name.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(resolve(root, file), "utf8"));
  const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  privateKey = keys.privateKey;
  const jwk = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
  publicKeyCose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x!, "base64url"), Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y!, "base64url")]);
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
      VALUES ('subject-a','subject-a','2026-09-23T00:00:00.000Z','2026-09-23T00:00:00.000Z');
    INSERT INTO security_profiles (subject_reference, updated_at)
      VALUES ('subject-a','2026-09-23T00:00:00.000Z');
    INSERT INTO beta_access (subject_reference, cohort, country_code, status, transaction_limit_usd, terms_version, terms_accepted_at, activated_at, updated_at)
      VALUES ('subject-a','test','PT','active',25000,'v1','2026-09-23T00:00:00.000Z','2026-09-23T00:00:00.000Z','2026-09-23T00:00:00.000Z');`);
  sqlite.prepare(`INSERT INTO action_passkey_credentials
    (credential_id,subject_reference,public_key_cose,algorithm,rp_id,created_at)
    VALUES (?,'subject-a',?,-7,?,'2026-09-23T00:00:00.000Z')`).run(credentialId, publicKeyCose, rpId);
  database = d1(sqlite);
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); });

describe("pending passkey possession", () => {
  it("binds a UV assertion to the exact pending credential and stores one-use evidence without activation", async () => {
    const issued = await issuePendingPasskeyPossessionChallenge(database, input);
    expect(sqlite.prepare("SELECT purpose, proposed_diff_digest FROM action_passkey_challenges WHERE challenge_id = ?")
      .get(issued.challengeId)).toMatchObject({ purpose: "credential_change",
        proposed_diff_digest: expect.stringMatching(/^passkey-possession:v1:sha256:[a-f0-9]{64}$/) });
    expect(issued.options.allowCredentials).toEqual([{ id: credentialId, type: "public-key" }]);
    expect(issued.options.userVerification).toBe("required");
    const response = await assertion(issued.challenge);
    await completePendingPasskeyPossession(database, { ...input, challengeId: issued.challengeId,
      challenge: issued.challenge, response });
    expect(sqlite.prepare("SELECT status, activated_at, sign_count FROM action_passkey_credentials").get())
      .toMatchObject({ status: "pending", activated_at: null, sign_count: 1 });
    expect(sqlite.prepare("SELECT action, target_reference FROM audit_events").get())
      .toMatchObject({ action: "action_passkey_possession_verified", target_reference: credentialId });
    await expect(completePendingPasskeyPossession(database, { ...input, challengeId: issued.challengeId,
      challenge: issued.challenge, response })).rejects.toThrow();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events").get()).toMatchObject({ n: 1 });
  });

  it("rejects wrong origin or RP, missing UV, forged signature and wrong challenge", async () => {
    const issued = await issuePendingPasskeyPossessionChallenge(database, input);
    const base = { ...input, challengeId: issued.challengeId, challenge: issued.challenge };
    for (const changes of [{ origin: "https://wrong.aurel.test" }, { rpId: "wrong.aurel.test" }, { flags: 0x01 }, { badSignature: true }])
      await expect(completePendingPasskeyPossession(database, { ...base, response: await assertion(issued.challenge, changes) })).rejects.toThrow();
    await expect(completePendingPasskeyPossession(database, { ...base, response: await assertion("b".repeat(43)) })).rejects.toThrow();
  });

  it("rejects substitution and drift without consuming", async () => {
    const issued = await issuePendingPasskeyPossessionChallenge(database, input);
    const response = await assertion(issued.challenge);
    await expect(completePendingPasskeyPossession(database, { ...input, challengeId: issued.challengeId,
      challenge: issued.challenge, sessionReference: "other-session", response })).rejects.toThrow();
    await expect(completePendingPasskeyPossession(database, { ...input, challengeId: issued.challengeId,
      challenge: issued.challenge, now: new Date("2026-09-23T00:04:00.000Z"), response })).rejects.toThrow();
    expect(sqlite.prepare("SELECT consumed_at FROM action_passkey_challenges").get()).toMatchObject({ consumed_at: null });
  });

  it("rejects a substituted pending public key and a counter regression", async () => {
    const issued = await issuePendingPasskeyPossessionChallenge(database, input);
    const other = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const originalKey = privateKey;
    privateKey = other.privateKey;
    const wrongKeyResponse = await assertion(issued.challenge);
    privateKey = originalKey;
    await expect(completePendingPasskeyPossession(database, { ...input, challengeId: issued.challengeId,
      challenge: issued.challenge, response: wrongKeyResponse })).rejects.toThrow();
    const response = await assertion(issued.challenge);
    sqlite.prepare("UPDATE action_passkey_credentials SET sign_count = 2 WHERE credential_id = ?").run(credentialId);
    await expect(completePendingPasskeyPossession(database, { ...input, challengeId: issued.challengeId,
      challenge: issued.challenge, response })).rejects.toThrow();
    expect(sqlite.prepare("SELECT consumed_at FROM action_passkey_challenges").get()).toMatchObject({ consumed_at: null });
  });

  it("rejects a second credential, revoked credential, or eligibility loss at completion", async () => {
    const issued = await issuePendingPasskeyPossessionChallenge(database, input);
    const response = await assertion(issued.challenge);
    const otherId = Buffer.from("other-pending-credential").toString("base64url");
    sqlite.prepare(`INSERT INTO action_passkey_credentials
      (credential_id,subject_reference,public_key_cose,algorithm,rp_id,created_at)
      VALUES (?,'subject-a',?,-7,?,'2026-09-23T00:00:00.000Z')`).run(otherId, publicKeyCose, rpId);
    await expect(completePendingPasskeyPossession(database, { ...input, credentialId: otherId,
      challengeId: issued.challengeId, challenge: issued.challenge, response })).rejects.toThrow();
    sqlite.exec("UPDATE security_profiles SET account_locked=1");
    await expect(completePendingPasskeyPossession(database, { ...input, challengeId: issued.challengeId,
      challenge: issued.challenge, response })).rejects.toThrow();
    sqlite.exec("UPDATE security_profiles SET account_locked=0; UPDATE beta_access SET status='suspended'");
    await expect(completePendingPasskeyPossession(database, { ...input, challengeId: issued.challengeId,
      challenge: issued.challenge, response })).rejects.toThrow();
    sqlite.exec("UPDATE beta_access SET status='active'");
    sqlite.prepare("UPDATE action_passkey_credentials SET status='revoked', revoked_at=? WHERE credential_id=?")
      .run("2026-09-23T00:02:00.000Z", credentialId);
    await expect(completePendingPasskeyPossession(database, { ...input, challengeId: issued.challengeId,
      challenge: issued.challenge, response })).rejects.toThrow();
    expect(sqlite.prepare("SELECT consumed_at FROM action_passkey_challenges WHERE challenge_id=?").get(issued.challengeId))
      .toMatchObject({ consumed_at: null });
  });

  it("has one winner for concurrent completions", async () => {
    const issued = await issuePendingPasskeyPossessionChallenge(database, input);
    const response = await assertion(issued.challenge);
    const completion = { ...input, challengeId: issued.challengeId, challenge: issued.challenge, response };
    const results = await Promise.allSettled([
      completePendingPasskeyPossession(database, completion), completePendingPasskeyPossession(database, completion)
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(sqlite.prepare("SELECT status, sign_count FROM action_passkey_credentials WHERE credential_id=?").get(credentialId))
      .toMatchObject({ status: "pending", sign_count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events").get()).toMatchObject({ n: 1 });
  });

  it("does not let two challenges reuse a positive authenticator counter", async () => {
    const first = await issuePendingPasskeyPossessionChallenge(database, input);
    const second = await issuePendingPasskeyPossessionChallenge(database, input);
    await completePendingPasskeyPossession(database, { ...input, challengeId: first.challengeId,
      challenge: first.challenge, response: await assertion(first.challenge, { counter: 1 }) });
    await expect(completePendingPasskeyPossession(database, { ...input, challengeId: second.challengeId,
      challenge: second.challenge, response: await assertion(second.challenge, { counter: 1 }) })).rejects.toThrow();
    expect(sqlite.prepare("SELECT consumed_at FROM action_passkey_challenges WHERE challenge_id=?").get(second.challengeId))
      .toMatchObject({ consumed_at: null });
  });

  it("accepts separate zero-counter assertions without allowing challenge replay", async () => {
    for (let index = 0; index < 2; index++) {
      const issued = await issuePendingPasskeyPossessionChallenge(database, input);
      const completion = { ...input, challengeId: issued.challengeId, challenge: issued.challenge,
        response: await assertion(issued.challenge, { counter: 0 }) };
      await completePendingPasskeyPossession(database, completion);
      await expect(completePendingPasskeyPossession(database, completion)).rejects.toThrow();
    }
    expect(sqlite.prepare("SELECT sign_count, counter_risk FROM action_passkey_credentials WHERE credential_id=?").get(credentialId))
      .toMatchObject({ sign_count: 0, counter_risk: "zero" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events").get()).toMatchObject({ n: 2 });
  });

  it("does not issue for an active credential, locked account, or production Worker origin", async () => {
    sqlite.exec("UPDATE action_passkey_credentials SET status='active', activated_at='2026-09-23T00:00:00.000Z'");
    await expect(issuePendingPasskeyPossessionChallenge(database, input)).rejects.toThrow();
    sqlite.exec("UPDATE action_passkey_credentials SET status='pending', activated_at=NULL; UPDATE security_profiles SET account_locked=1");
    await expect(issuePendingPasskeyPossessionChallenge(database, input)).rejects.toThrow();
    const worker = "aurel-financial-os.aurel-events.workers.dev";
    await expect(issuePendingPasskeyPossessionChallenge(database, { ...input, origin: `https://${worker}`,
      rpId: worker, deploymentMode: "production" })).rejects.toThrow();
  });
});
