import { generateAuthenticationOptions, type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { configuredCountries } from "@/lib/beta/access";
import { verifyPendingPasskeyPossession, type VerifiedActionPasskeyAssertion } from "./action-passkey-assertion";
import { validateActionPasskeyOrigin } from "./action-passkey-origin";

type Binding = {
  subjectReference: string;
  sessionReference: string;
  credentialId: string;
  origin: string;
  rpId: string;
  deploymentMode: "development" | "production";
  now: Date;
};

function validateBinding(input: Binding): string[] {
  validateActionPasskeyOrigin(input.origin, input.rpId, input.deploymentMode);
  if (!input.subjectReference || !input.sessionReference || !/^[A-Za-z0-9_-]+$/.test(input.credentialId)
    || !Number.isFinite(input.now.getTime())) throw new Error("Invalid passkey possession binding.");
  const countries = configuredCountries();
  if (!countries.length) throw new Error("Passkey possession requires a launch-country allowlist.");
  return countries;
}

async function digest(value: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function possessionBinding(credentialId: string): Promise<string> {
  return `passkey-possession:v1:${await digest(credentialId)}`;
}

/** Separate, unexposed ceremony; proving possession never activates the credential. */
export async function issuePendingPasskeyPossessionChallenge(db: D1Database, input: Binding): Promise<{
  challengeId: string; challenge: string; expiresAt: string; options: PublicKeyCredentialRequestOptionsJSON;
}> {
  const countries = validateBinding(input);
  const options = await generateAuthenticationOptions({ rpID: input.rpId,
    allowCredentials: [{ id: input.credentialId }], userVerification: "required", timeout: 120_000 });
  const challengeId = crypto.randomUUID();
  const now = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + 120_000).toISOString();
  const result = await db.prepare(`INSERT INTO action_passkey_challenges
    (challenge_id,challenge_digest,subject_reference,session_reference,purpose,proposed_diff_digest,
     rp_id,origin,expires_at,created_at)
    SELECT ?, ?, k.subject_reference, ?, 'credential_change', ?, k.rp_id, ?, ?, ?
    FROM action_passkey_credentials k
    JOIN security_profiles p ON p.subject_reference = k.subject_reference
    JOIN beta_access b ON b.subject_reference = k.subject_reference
    WHERE k.credential_id = ? AND k.subject_reference = ? AND k.rp_id = ? AND k.status = 'pending'
      AND p.account_locked = 0 AND b.status = 'active'
      AND b.country_code IN (SELECT value FROM json_each(?))`)
    .bind(challengeId, await digest(options.challenge), input.sessionReference, await possessionBinding(input.credentialId),
      input.origin, expiresAt, now, input.credentialId, input.subjectReference, input.rpId,
      JSON.stringify(countries)).run();
  if (result.meta.changes !== 1) throw new Error("Pending passkey possession is unavailable for this credential.");
  return { challengeId, challenge: options.challenge, expiresAt, options };
}

/** Store signed possession evidence once. Bootstrap assurance and activation remain separate. */
async function storePendingPasskeyPossession(db: D1Database, input: Binding & {
  challengeId: string; verified: VerifiedActionPasskeyAssertion;
}): Promise<void> {
  const countries = validateBinding(input);
  if (!input.challengeId || input.verified.credentialId !== input.credentialId
    || input.verified.origin !== input.origin || input.verified.rpId !== input.rpId
    || !/^sha256:[a-f0-9]{64}$/.test(input.verified.challengeDigest)
    || !Number.isSafeInteger(input.verified.newCounter) || input.verified.newCounter < 0
    || input.verified.newCounter > 0xffffffff) throw new Error("Invalid passkey possession evidence.");
  const now = input.now.toISOString();
  const [consumed, advanced, audited] = await db.batch([
    db.prepare(`UPDATE action_passkey_challenges SET consumed_at = ?
      WHERE challenge_id = ? AND challenge_digest = ? AND subject_reference = ? AND session_reference = ?
        AND purpose = 'credential_change' AND proposed_diff_digest = ? AND rp_id = ? AND origin = ?
        AND consumed_at IS NULL AND created_at <= ? AND expires_at > ?
        AND EXISTS (SELECT 1 FROM security_profiles p WHERE p.subject_reference = action_passkey_challenges.subject_reference
          AND p.account_locked = 0)
        AND EXISTS (SELECT 1 FROM beta_access b WHERE b.subject_reference = action_passkey_challenges.subject_reference
          AND b.status = 'active' AND b.country_code IN (SELECT value FROM json_each(?)))
        AND EXISTS (SELECT 1 FROM action_passkey_credentials k
          WHERE k.credential_id = ? AND k.subject_reference = action_passkey_challenges.subject_reference
            AND k.rp_id = action_passkey_challenges.rp_id AND k.status = 'pending'
            AND (? > k.sign_count OR (? = 0 AND k.sign_count = 0)))`)
      .bind(now, input.challengeId, input.verified.challengeDigest, input.subjectReference,
        input.sessionReference, await possessionBinding(input.credentialId), input.rpId, input.origin, now, now,
        JSON.stringify(countries), input.credentialId, input.verified.newCounter, input.verified.newCounter),
    db.prepare(`UPDATE action_passkey_credentials
      SET sign_count = ?, counter_risk = CASE WHEN ? = 0 THEN 'zero' ELSE 'none' END
      WHERE credential_id = ? AND subject_reference = ? AND rp_id = ? AND status = 'pending'
        AND changes() = 1 AND (? > sign_count OR (? = 0 AND sign_count = 0))
        AND EXISTS (SELECT 1 FROM action_passkey_challenges c WHERE c.challenge_id = ?
          AND c.consumed_at = ? AND c.subject_reference = action_passkey_credentials.subject_reference)`)
      .bind(input.verified.newCounter, input.verified.newCounter, input.credentialId, input.subjectReference,
        input.rpId, input.verified.newCounter, input.verified.newCounter, input.challengeId, now),
    db.prepare(`INSERT INTO audit_events
      (audit_id,subject_reference,actor_type,actor_reference,action,target_type,target_reference,evidence_json,occurred_at)
      SELECT ?, c.subject_reference, CASE WHEN changes() = 1 THEN 'customer' ELSE NULL END,
        c.subject_reference, 'action_passkey_possession_verified', 'action_passkey_credential', ?, ?, ?
      FROM action_passkey_challenges c WHERE c.challenge_id = ?`)
      .bind(crypto.randomUUID(), input.credentialId, JSON.stringify({ challengeId: input.challengeId, rpId: input.rpId }),
        now, input.challengeId)
  ]);
  if (consumed.meta.changes !== 1 || advanced.meta.changes !== 1 || audited.meta.changes !== 1)
    throw new Error("Pending passkey possession was not committed.");
}

/** Read the immutable stored key, verify its signed assertion, then commit one-use evidence. */
export async function completePendingPasskeyPossession(db: D1Database, input: Binding & {
  challengeId: string; challenge: string; response: AuthenticationResponseJSON;
}): Promise<void> {
  validateBinding(input);
  if (!input.challengeId || !/^[A-Za-z0-9_-]{43}$/.test(input.challenge))
    throw new Error("Invalid passkey possession challenge.");
  const row = await db.prepare(`SELECT public_key_cose, sign_count FROM action_passkey_credentials
    WHERE credential_id = ? AND subject_reference = ? AND rp_id = ? AND status = 'pending'`)
    .bind(input.credentialId, input.subjectReference, input.rpId)
    .first<{ public_key_cose: number[] | Uint8Array; sign_count: number }>();
  if (!row) throw new Error("Pending passkey credential is unavailable.");
  const verified = await verifyPendingPasskeyPossession({ response: input.response,
    challenge: input.challenge, expectedOrigin: input.origin, expectedRpId: input.rpId,
    deploymentMode: input.deploymentMode, subjectReference: input.subjectReference,
    credential: { credentialId: input.credentialId, subjectReference: input.subjectReference,
      publicKeyCose: new Uint8Array(row.public_key_cose), counter: row.sign_count,
      status: "pending", rpId: input.rpId } });
  await storePendingPasskeyPossession(db, { ...input, verified });
}
