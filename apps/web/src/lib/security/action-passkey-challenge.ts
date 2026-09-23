import { configuredCountries } from "@/lib/beta/access";
import { VALUATION_POLICY_VERSION } from "@/lib/transactions/valuation";

/** All fields are derived from authenticated server state/configuration, never browser approval claims. */
type ChallengeInput = {
  subjectReference: string;
  sessionReference: string;
  intentId: string;
  stepIndex: number;
  callFingerprint: string;
  policyVersion: number;
  /** Server-owned exact HTTPS configuration, never a value supplied by the browser. */
  origin: string;
  rpId: string;
  now: Date;
};

/** Create a short-lived, action-bound challenge. This service is not connected to a public route. */
export async function issueActionPasskeyChallenge(
  db: D1Database, input: ChallengeInput
): Promise<{ challengeId: string; challenge: string; expiresAt: string }> {
  let url: URL;
  try { url = new URL(input.origin); } catch { throw new Error("Invalid passkey origin configuration."); }
  if (url.protocol !== "https:" || url.origin !== input.origin || url.hostname !== input.rpId ||
      input.rpId === "workers.dev" || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(input.rpId) ||
      !input.subjectReference || !input.sessionReference || !input.intentId || !input.callFingerprint ||
      !Number.isSafeInteger(input.stepIndex) || input.stepIndex < 0 ||
      !Number.isSafeInteger(input.policyVersion) || input.policyVersion < 1 ||
      !Number.isFinite(input.now.getTime())) {
    throw new Error("Invalid passkey challenge binding.");
  }
  const countries = configuredCountries();
  if (!countries.length) throw new Error("Passkey challenge issuance requires a launch-country allowlist.");

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const challenge = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(challenge)));
  const digest = `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const challengeId = crypto.randomUUID();
  const now = input.now.toISOString();
  const maxExpiry = new Date(input.now.getTime() + 120_000).toISOString();
  const freshSince = new Date(input.now.getTime() - 180_000).toISOString();

  // A single INSERT...SELECT sees one D1 snapshot. Consume-time checks are deliberately
  // stronger and must still be run after the assertion; issuance never permits signing.
  const result = await db.prepare(`INSERT INTO action_passkey_challenges
    (challenge_id, challenge_digest, subject_reference, session_reference, purpose,
     intent_id, step_index, call_fingerprint, policy_version, rp_id, origin, expires_at, created_at)
    SELECT ?, ?, i.subject_reference, ?, 'intent_step', i.intent_id, c.step_index,
      c.call_fingerprint, p.policy_version, ?, ?, min(?, i.expires_at, c.expires_at), ?
    FROM transaction_intents i
    JOIN intent_prepared_calls c ON c.intent_id = i.intent_id AND c.subject_reference = i.subject_reference
    JOIN wallet_references w ON w.wallet_reference = i.wallet_reference
      AND w.subject_reference = i.subject_reference AND w.chain_family = 'evm'
      AND lower(w.address) = lower(c.wallet_address)
    JOIN security_profiles p ON p.subject_reference = i.subject_reference
    JOIN beta_access b ON b.subject_reference = i.subject_reference
    WHERE i.intent_id = ? AND i.subject_reference = ? AND i.intent_type = 'transfer'
      AND i.chain_id = 8453 AND i.status = 'reviewed' AND i.expires_at > ?
      AND (i.release_at IS NULL OR i.release_at <= ?)
      AND json_extract(i.request_json, '$.type') = 'transfer'
      AND json_extract(i.policy_result_json, '$.permitted') = 1
      AND c.step_index = ? AND c.call_fingerprint = ? AND c.verification_state = 'prepared'
      AND c.chain_id = i.chain_id AND c.expires_at > ?
      AND c.semantic_action IN ('native_transfer', 'erc20_transfer')
      AND lower(json_extract(c.expected_effect_json, '$.recipient')) = lower(json_extract(i.request_json, '$.destination'))
      AND p.account_locked = 0 AND p.policy_version = ?
      AND b.status = 'active' AND b.country_code IN (SELECT value FROM json_each(?))
      AND EXISTS (SELECT 1 FROM feature_flags f WHERE f.flag_key = 'direct_transfers'
        AND f.enabled = 1 AND f.audience IN ('all', 'beta'))
      AND EXISTS (SELECT 1 FROM action_passkey_credentials k WHERE k.subject_reference = i.subject_reference
        AND k.rp_id = ? AND k.status = 'active')
      AND EXISTS (SELECT 1 FROM address_book_entries a WHERE a.subject_reference = i.subject_reference
        AND a.chain_family = 'evm' AND lower(a.address) = lower(json_extract(i.request_json, '$.destination'))
        AND a.available_at <= ?)
      AND EXISTS (SELECT 1 FROM intent_valuations v WHERE v.intent_id = i.intent_id
        AND v.rowid = (SELECT MAX(latest.rowid) FROM intent_valuations latest WHERE latest.intent_id = i.intent_id)
        AND v.policy_version = ? AND v.usd_cents != '' AND v.usd_cents NOT GLOB '*[^0-9]*'
        AND length(v.usd_cents) <= 15 AND CAST(v.usd_cents AS INTEGER) > 0
        AND v.raw_units = json_extract(c.expected_effect_json, '$.amountRaw')
        AND v.asset_id = CASE c.semantic_action WHEN 'native_transfer' THEN '8453:native'
          WHEN 'erc20_transfer' THEN '8453:' || lower(json_extract(c.expected_effect_json, '$.token')) ELSE '' END
        AND v.price_observed_at >= ? AND v.price_observed_at <= ?
        AND v.valued_at >= ? AND v.valued_at <= ? AND v.valued_at >= v.price_observed_at
        AND p.daily_limit_usd >= 0 AND b.transaction_limit_usd >= 0
        AND CAST(v.usd_cents AS INTEGER) <= CAST(MIN(p.daily_limit_usd, b.transaction_limit_usd) * 100 AS INTEGER))`)
    .bind(challengeId, digest, input.sessionReference, input.rpId, input.origin, maxExpiry, now,
      input.intentId, input.subjectReference, now, now, input.stepIndex, input.callFingerprint,
      now, input.policyVersion, JSON.stringify(countries), input.rpId, now,
      VALUATION_POLICY_VERSION, freshSince, now, freshSince, now).run();
  if (result.meta.changes !== 1) throw new Error("This action is not eligible for a passkey challenge.");
  // The selected expiry is bounded by the reviewed intent and prepared call. It is
  // read only after insertion; the digest, not the raw challenge, is durable.
  const row = await db.prepare("SELECT expires_at FROM action_passkey_challenges WHERE challenge_id = ?")
    .bind(challengeId).first<{ expires_at: string }>();
  if (!row) throw new Error("Passkey challenge was not stored.");
  return { challengeId, challenge, expiresAt: row.expires_at };
}
