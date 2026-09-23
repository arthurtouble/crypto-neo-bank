import type { VerifiedActionPasskeyAssertion } from "@/lib/security/action-passkey-assertion";
import { configuredCountries } from "@/lib/beta/access";
import { VALUATION_POLICY_VERSION } from "@/lib/transactions/valuation";

type ActionPasskeyEvidence = {
  challengeId: string;
  challengeDigest: string;
  subjectReference: string;
  sessionReference: string;
  intentId: string;
  stepIndex: number;
  callFingerprint: string;
  policyVersion: number;
  origin: string;
  rpId: string;
  now: Date;
  verified: VerifiedActionPasskeyAssertion;
};

/** Persist verified assertion evidence only; this does not permit signing or expose an endpoint. */
export async function consumeVerifiedActionPasskey(
  db: D1Database, input: ActionPasskeyEvidence
): Promise<{ authorizationId: string }> {
  const { verified } = input;
  if (verified.origin !== input.origin || verified.rpId !== input.rpId ||
      verified.challengeDigest !== input.challengeDigest ||
      !Number.isSafeInteger(verified.newCounter) || verified.newCounter < 0 || verified.newCounter > 0xffffffff ||
      !Number.isSafeInteger(input.stepIndex) || input.stepIndex < 0 ||
      !Number.isSafeInteger(input.policyVersion) || input.policyVersion < 1 ||
      !Number.isFinite(input.now.getTime())) {
    throw new Error("Passkey evidence is invalid.");
  }
  const allowedCountries = configuredCountries();
  if (!allowedCountries.length) throw new Error("Passkey authorization is not available without a launch-country allowlist.");
  const now = input.now.toISOString();
  const rollingStart = new Date(input.now.getTime() - 86_400_000).toISOString();
  const valuationFreshSince = new Date(input.now.getTime() - 180_000).toISOString();
  const authorizationId = crypto.randomUUID();
  const [consumed, advanced, authorized] = await db.batch([
    db.prepare(`UPDATE action_passkey_challenges SET consumed_at = ?
      WHERE challenge_id = ? AND challenge_digest = ? AND subject_reference = ?
        AND session_reference = ? AND purpose = 'intent_step' AND intent_id = ?
        AND step_index = ? AND call_fingerprint = ? AND policy_version = ?
        AND rp_id = ? AND origin = ? AND consumed_at IS NULL
        AND created_at <= ? AND expires_at > ?
        AND EXISTS (SELECT 1 FROM security_profiles p
          WHERE p.subject_reference = action_passkey_challenges.subject_reference
            AND p.account_locked = 0 AND p.policy_version = action_passkey_challenges.policy_version)
        AND EXISTS (SELECT 1 FROM beta_access b
          WHERE b.subject_reference = action_passkey_challenges.subject_reference
            AND b.status = 'active' AND b.country_code IN (SELECT value FROM json_each(?)))
        AND EXISTS (SELECT 1 FROM feature_flags f
          WHERE f.flag_key = 'direct_transfers' AND f.enabled = 1 AND f.audience IN ('all', 'beta'))
        AND EXISTS (SELECT 1 FROM transaction_intents i
          WHERE i.intent_id = action_passkey_challenges.intent_id
            AND i.subject_reference = action_passkey_challenges.subject_reference
            AND i.intent_type = 'transfer' AND i.status = 'reviewed' AND i.expires_at > ?
            AND (i.release_at IS NULL OR i.release_at <= ?)
            AND json_extract(i.request_json, '$.type') = 'transfer'
            AND json_extract(i.policy_result_json, '$.permitted') = 1
            AND EXISTS (SELECT 1 FROM address_book_entries a
              WHERE a.subject_reference = i.subject_reference AND a.chain_family = 'evm'
                AND lower(a.address) = lower(json_extract(i.request_json, '$.destination'))
                AND a.available_at <= ?))
        AND EXISTS (SELECT 1 FROM intent_prepared_calls c
          WHERE c.intent_id = action_passkey_challenges.intent_id
            AND c.step_index = action_passkey_challenges.step_index
            AND c.subject_reference = action_passkey_challenges.subject_reference
            AND c.call_fingerprint = action_passkey_challenges.call_fingerprint
            AND c.verification_state = 'prepared' AND c.expires_at > ?
            AND c.semantic_action IN ('native_transfer', 'erc20_transfer')
            AND EXISTS (SELECT 1 FROM transaction_intents i
              WHERE i.intent_id = c.intent_id AND i.chain_id = c.chain_id
                AND lower(json_extract(c.expected_effect_json, '$.recipient')) =
                    lower(json_extract(i.request_json, '$.destination'))))
        AND EXISTS (SELECT 1 FROM intent_valuations v
          WHERE v.intent_id = action_passkey_challenges.intent_id
            AND v.rowid = (SELECT MAX(latest.rowid) FROM intent_valuations latest
              WHERE latest.intent_id = action_passkey_challenges.intent_id)
            AND v.policy_version = ? AND v.usd_cents != ''
            AND v.usd_cents NOT GLOB '*[^0-9]*' AND length(v.usd_cents) <= 15
            AND CAST(v.usd_cents AS INTEGER) > 0
            AND EXISTS (SELECT 1 FROM intent_prepared_calls valued_call
              WHERE valued_call.intent_id = v.intent_id
                AND valued_call.step_index = action_passkey_challenges.step_index
                AND v.raw_units = json_extract(valued_call.expected_effect_json, '$.amountRaw')
                AND v.asset_id = CASE valued_call.semantic_action
                  WHEN 'native_transfer' THEN '8453:native'
                  WHEN 'erc20_transfer' THEN '8453:' || lower(json_extract(valued_call.expected_effect_json, '$.token'))
                  ELSE '' END)
            AND v.price_observed_at >= ? AND v.price_observed_at <= ?
            AND v.valued_at >= ? AND v.valued_at <= ?
            AND v.valued_at >= v.price_observed_at
            AND EXISTS (SELECT 1 FROM security_profiles p JOIN beta_access b
              ON b.subject_reference = p.subject_reference
              WHERE p.subject_reference = action_passkey_challenges.subject_reference
                AND p.daily_limit_usd >= 0 AND b.transaction_limit_usd >= 0
                AND EXISTS (SELECT 1 FROM (
                  SELECT COALESCE(SUM(CAST(spent_value.usd_cents AS INTEGER)), 0) AS cents,
                    COALESCE(SUM(CASE WHEN spent_value.valuation_id IS NULL
                      OR spent_value.usd_cents = '' OR spent_value.usd_cents GLOB '*[^0-9]*'
                      OR length(spent_value.usd_cents) > 15 THEN 1 ELSE 0 END), 0) AS missing
                  FROM transaction_intents spending LEFT JOIN intent_valuations spent_value
                    ON spent_value.rowid = (SELECT MAX(latest_spent.rowid) FROM intent_valuations latest_spent
                      WHERE latest_spent.intent_id = spending.intent_id)
                  WHERE spending.subject_reference = action_passkey_challenges.subject_reference
                    AND spending.intent_id != action_passkey_challenges.intent_id
                    AND (spending.created_at >= ? OR EXISTS (SELECT 1 FROM intent_prepared_calls recent
                      WHERE recent.intent_id = spending.intent_id AND recent.created_at >= ?))
                    AND (spending.status IN ('submitted', 'confirmed') OR EXISTS (
                      SELECT 1 FROM intent_prepared_calls reserved_call
                      WHERE reserved_call.intent_id = spending.intent_id
                        AND reserved_call.expires_at > ? AND reserved_call.verification_state != 'failed'))
                ) reserved_spend WHERE reserved_spend.missing = 0
                  AND reserved_spend.cents + CAST(v.usd_cents AS INTEGER)
                    <= CAST(MIN(p.daily_limit_usd, b.transaction_limit_usd) * 100 AS INTEGER))))
        AND EXISTS (SELECT 1 FROM action_passkey_credentials k
          WHERE k.credential_id = ? AND k.subject_reference = action_passkey_challenges.subject_reference
            AND k.rp_id = action_passkey_challenges.rp_id AND k.status = 'active'
            AND (? > k.sign_count OR (? = 0 AND k.sign_count = 0)))`)
      .bind(now, input.challengeId, input.challengeDigest, input.subjectReference,
        input.sessionReference, input.intentId, input.stepIndex, input.callFingerprint,
        input.policyVersion, input.rpId, input.origin, now, now,
        JSON.stringify(allowedCountries), now, now, now, now,
        VALUATION_POLICY_VERSION, valuationFreshSince, now, valuationFreshSince, now,
        rollingStart, rollingStart, now,
        verified.credentialId, verified.newCounter, verified.newCounter),
    db.prepare(`UPDATE action_passkey_credentials
      SET sign_count = ?, counter_risk = CASE WHEN ? = 0 THEN 'zero' ELSE 'none' END
      WHERE credential_id = ? AND subject_reference = ? AND rp_id = ? AND status = 'active'
        AND changes() = 1 AND (? > sign_count OR (? = 0 AND sign_count = 0))
        AND EXISTS (SELECT 1 FROM action_passkey_challenges c
          WHERE c.challenge_id = ? AND c.consumed_at = ? AND c.subject_reference = action_passkey_credentials.subject_reference)`)
      .bind(verified.newCounter, verified.newCounter, verified.credentialId,
        input.subjectReference, input.rpId, verified.newCounter, verified.newCounter,
        input.challengeId, now),
    db.prepare(`INSERT INTO action_passkey_authorizations
      (authorization_id, challenge_id, credential_id, subject_reference, purpose, intent_id,
       step_index, call_fingerprint, policy_version, authorized_at, expires_at)
      VALUES (?, ?, ?, ?, 'intent_step', ?, ?, ?, ?, ?,
        (SELECT min(c.expires_at, p.expires_at, i.expires_at)
         FROM action_passkey_challenges c
         JOIN intent_prepared_calls p ON p.intent_id = c.intent_id AND p.step_index = c.step_index
         JOIN transaction_intents i ON i.intent_id = c.intent_id
         WHERE c.challenge_id = ?))`)
      .bind(authorizationId, input.challengeId, verified.credentialId, input.subjectReference,
        input.intentId, input.stepIndex, input.callFingerprint, input.policyVersion, now, input.challengeId)
  ]);
  if (consumed.meta.changes !== 1 || advanced.meta.changes !== 1 || authorized.meta.changes !== 1) {
    throw new Error("Passkey authorization was not committed.");
  }
  return { authorizationId };
}
