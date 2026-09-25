import { generateRegistrationOptions, verifyRegistrationResponse, type PublicKeyCredentialCreationOptionsJSON, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { cose, decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";
import { validateActionPasskeyOrigin } from "./action-passkey-origin";

export type VerifyPendingRegistrationInput = {
  response: RegistrationResponseJSON;
  challenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  deploymentMode: "development" | "production";
  subjectReference: string;
};

export type PendingRegistrationChallengeInput = {
  subjectReference: string;
  sessionReference: string;
  origin: string;
  rpId: string;
  deploymentMode: "development" | "production";
  now: Date;
};

export async function issuePendingRegistrationChallenge(db: D1Database, input: PendingRegistrationChallengeInput): Promise<{
  challengeId: string; challenge: string; expiresAt: string; options: PublicKeyCredentialCreationOptionsJSON;
}> {
  validateActionPasskeyOrigin(input.origin, input.rpId, input.deploymentMode);
  if (!input.subjectReference || !input.sessionReference || !Number.isFinite(input.now.getTime()))
    throw new Error("Invalid passkey registration binding.");
  const userID = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.subjectReference)));
  const options = await generateRegistrationOptions({
    rpName: "Aura", rpID: input.rpId, userName: "Aura account", userID,
    attestationType: "none", timeout: 300_000,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [-7, -257]
  });
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(options.challenge)));
  const digest = `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const challengeId = crypto.randomUUID();
  const now = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + 300_000).toISOString();
  const inserted = await db.prepare(`INSERT INTO action_passkey_challenges
    (challenge_id, challenge_digest, subject_reference, session_reference, purpose, rp_id, origin, expires_at, created_at)
    SELECT ?, ?, s.subject_reference, ?, 'registration', ?, ?, ?, ? FROM subject_profiles s
    JOIN security_profiles p ON p.subject_reference = s.subject_reference
    WHERE s.subject_reference = ? AND p.account_locked = 0`)
    .bind(challengeId, digest, input.sessionReference, input.rpId, input.origin, expiresAt, now,
      input.subjectReference).run();
  if (inserted.meta.changes !== 1) throw new Error("Passkey registration is unavailable for this account.");
  return { challengeId, challenge: options.challenge, expiresAt, options };
}

declare const pendingRegistrationBrand: unique symbol;
export type VerifiedPendingRegistration = {
  credentialId: string;
  subjectReference: string;
  publicKeyCose: Uint8Array;
  algorithm: -7 | -257;
  counter: number;
  origin: string;
  rpId: string;
  challengeDigest: string;
  readonly [pendingRegistrationBrand]: true;
};

export type StorePendingRegistrationInput = {
  challengeId: string;
  subjectReference: string;
  sessionReference: string;
  origin: string;
  rpId: string;
  deploymentMode: "development" | "production";
  now: Date;
  verified: VerifiedPendingRegistration;
};

export async function storePendingActionPasskeyRegistration(db: D1Database, input: StorePendingRegistrationInput): Promise<void> {
  validateActionPasskeyOrigin(input.origin, input.rpId, input.deploymentMode);
  const credential = input.verified;
  if (!input.challengeId || !input.subjectReference || !input.sessionReference || !Number.isFinite(input.now.getTime())
    || credential.subjectReference !== input.subjectReference || credential.origin !== input.origin
    || credential.rpId !== input.rpId || !/^[A-Za-z0-9_-]+$/.test(credential.credentialId)
    || !/^sha256:[a-f0-9]{64}$/.test(credential.challengeDigest)
    || ![ -7, -257 ].includes(credential.algorithm) || !Number.isSafeInteger(credential.counter) || credential.counter < 0
    || credential.publicKeyCose.length === 0)
    throw new Error("Invalid pending passkey registration evidence.");
  const now = input.now.toISOString();
  const [consumed, stored, audited] = await db.batch([
    db.prepare(`UPDATE action_passkey_challenges SET consumed_at = ?
      WHERE challenge_id = ? AND challenge_digest = ? AND subject_reference = ? AND session_reference = ?
        AND purpose = 'registration' AND rp_id = ? AND origin = ?
        AND consumed_at IS NULL AND created_at <= ? AND expires_at > ?
        AND EXISTS (SELECT 1 FROM security_profiles p WHERE p.subject_reference = action_passkey_challenges.subject_reference AND p.account_locked = 0)`)
      .bind(now, input.challengeId, credential.challengeDigest, input.subjectReference, input.sessionReference,
        input.rpId, input.origin, now, now),
    db.prepare(`INSERT INTO action_passkey_credentials
      (credential_id, subject_reference, public_key_cose, algorithm, rp_id, sign_count, status, created_at)
      SELECT ?, c.subject_reference, ?, ?, c.rp_id, ?, 'pending', ? FROM action_passkey_challenges c
      WHERE c.challenge_id = ? AND c.consumed_at = ? AND c.challenge_digest = ? AND changes() = 1`)
      .bind(credential.credentialId, credential.publicKeyCose, credential.algorithm, credential.counter, now,
        input.challengeId, now, credential.challengeDigest),
    db.prepare(`INSERT INTO audit_events
      (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      SELECT ?, c.subject_reference, 'customer', c.subject_reference, 'action_passkey_registration_pending',
        'action_passkey_credential', c.credential_id, ?, ? FROM action_passkey_credentials c
      WHERE c.credential_id = ? AND c.subject_reference = ? AND c.status = 'pending' AND c.created_at = ? AND changes() = 1`)
      .bind(crypto.randomUUID(), JSON.stringify({ challengeId: input.challengeId, rpId: input.rpId }), now,
        credential.credentialId, input.subjectReference, now)
  ]);
  if (consumed.meta.changes !== 1 || stored.meta.changes !== 1 || audited.meta.changes !== 1)
    throw new Error("Pending passkey registration was not committed.");
}

export async function verifyPendingActionPasskeyRegistration(input: VerifyPendingRegistrationInput): Promise<VerifiedPendingRegistration> {
  validateActionPasskeyOrigin(input.expectedOrigin, input.expectedRpId, input.deploymentMode);
  if (!input.subjectReference || !/^[A-Za-z0-9_-]{43}$/.test(input.challenge)
    || input.response.response.attestationObject.length > 131_072
    || input.response.response.clientDataJSON.length > 8_192)
    throw new Error("Invalid passkey registration binding.");
  const verified = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: input.challenge,
    expectedOrigin: input.expectedOrigin,
    expectedRPID: input.expectedRpId,
    expectedType: "webauthn.create",
    requireUserVerification: true,
    supportedAlgorithmIDs: [-7, -257]
  });
  if (!verified.verified || !verified.registrationInfo.userVerified
    || verified.registrationInfo.origin !== input.expectedOrigin
    || verified.registrationInfo.rpID !== input.expectedRpId
    || verified.registrationInfo.credential.id !== input.response.id
    || !Number.isSafeInteger(verified.registrationInfo.credential.counter)
    || verified.registrationInfo.credential.counter < 0)
    throw new Error("Passkey registration was not verified.");
  const publicKeyCose = new Uint8Array(verified.registrationInfo.credential.publicKey);
  const algorithm = decodeCredentialPublicKey(publicKeyCose).get(cose.COSEKEYS.alg);
  if (algorithm !== -7 && algorithm !== -257) throw new Error("Unsupported passkey algorithm.");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.challenge)));
  return {
    credentialId: verified.registrationInfo.credential.id,
    subjectReference: input.subjectReference,
    publicKeyCose,
    algorithm,
    counter: verified.registrationInfo.credential.counter,
    origin: verified.registrationInfo.origin,
    rpId: verified.registrationInfo.rpID,
    challengeDigest: `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
  } as VerifiedPendingRegistration;
}
