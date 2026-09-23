# Action-Bound Passkey Verification Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove a server-only WebAuthn assertion verifier and one-use authorization store without enabling a customer signing path.

**Architecture:** The existing `0024_action_passkey_foundation.sql` stores credential, challenge, and authorization evidence. A pure verifier checks a browser assertion against one active subject-owned credential and an exact configured origin/RP ID; a separate D1 service consumes the matching challenge once and records authorization for only the immutable reviewed call. Neither module is imported by a public route until registration, recovery, server simulation, and final-domain work pass their own review.

**Tech Stack:** TypeScript, Cloudflare Workers WebCrypto, `@simplewebauthn/server`, D1/SQLite, Vitest, isolated Wrangler recovery drill.

**Spec:** [Action-Bound Step-Up for Aurel](../specs/2026-09-23-aurel-action-bound-passkey-design.md)

## Global Constraints

- Keep `/api/intents/prepare` returning `step_up_unavailable` for required step-up and keep security-policy relaxations returning 409.
- Keep production enrollment and authorization endpoints absent until an exact custom HTTPS origin/RP ID, bootstrap/recovery assurance, and independent security review exist.
- The current `workers.dev` host may be an exact development RP ID only; never use the shared `workers.dev` suffix.
- An Aurel assertion gates Aurel's own API, not the underlying self-custody wallet or any independent Privy `sendTransaction` call.
- A challenge is bound to subject, session, purpose, intent, step, exact call fingerprint, policy version, origin, RP ID, and expiry. It may authorize only one call once.
- Public key and security evidence are durable D1 records. They are not balances or custody secrets.
- Use test-first changes, reviewed commits, and no automated mainnet signatures.

## Review Focus

1. An assertion from the right credential but wrong origin/RP must fail; Task 1 tests both.
2. A correct signature without the UV flag must fail; Task 1 tests it.
3. A valid assertion for a different session, intent, step, fingerprint, purpose, or policy version must not consume or authorize; Task 2 tests each field.
4. Concurrent or replayed assertions must yield at most one authorization; Task 2 tests the real SQLite conditional update and transaction.
5. A revoked credential or a changed account lock/policy after challenge issuance must leave the action blocked; Task 2 tests both and reruns the disconnected product gates.

## Task 1: Verify one WebAuthn assertion without exposing an endpoint

**Files:**
- Modify: `apps/web/package.json`, `pnpm-lock.yaml`
- Create: `apps/web/src/lib/security/action-passkey-assertion.ts`
- Create: `apps/web/tests/unit/action-passkey-assertion.test.ts`

**Interfaces:**
- Consumes: `credential_id`, `public_key_cose`, `sign_count`, `status`, `rp_id` from migration `0024` and an exact configured HTTPS origin/RP ID.
- Produces: `verifyActionPasskeyAssertion(input): Promise<{ credentialId: string; newCounter: number; origin: string; rpId: string }>`; throws for every unverifiable response. The input contains the stored, server-generated base64url challenge and the `AuthenticationResponseJSON`, never a browser-proposed expected challenge.

```ts
type StoredActionCredential = {
  credentialId: string; subjectReference: string; publicKeyCose: Uint8Array;
  counter: number; status: "pending" | "active" | "revoked"; rpId: string;
};
type VerifyActionPasskeyInput = {
  response: AuthenticationResponseJSON; challenge: string; expectedOrigin: string;
  expectedRpId: string; subjectReference: string; credential: StoredActionCredential;
};
```

- [ ] Add `@simplewebauthn/server` as a direct dependency at a reviewed fixed major version. Check its installed type signature and Workers bundle before coding against it.
- [ ] Write a fixture that generates an ES256 P-256 key with WebCrypto, encodes its public key as COSE, constructs `authenticatorData` from SHA-256(RP ID), UP+UV flags and a counter, and signs `authenticatorData || SHA-256(clientDataJSON)`; encode the signature in the authenticator's DER form. Use it to test a valid assertion and one mutation at a time: wrong challenge, wrong origin, wrong RP hash, missing UV, bad signature, wrong credential ID, revoked credential, and counter regression.
- [ ] Run `pnpm --filter @aurel/web exec vitest run tests/unit/action-passkey-assertion.test.ts`. Expected: tests fail because the verifier does not exist.
- [ ] Implement the minimal wrapper around `verifyAuthenticationResponse`. Reject an inactive or foreign credential and invalid exact-origin/RP configuration before the library call. Use only one expected origin/RP, and require UV and the ordinary WebAuthn assertion type:

```ts
const verified = await verifyAuthenticationResponse({
  response: input.response,
  expectedChallenge: input.challenge,
  expectedOrigin: input.expectedOrigin,
  expectedRPID: input.expectedRpId,
  expectedType: "webauthn.get",
  requireUserVerification: true,
  credential: { id: input.credential.credentialId, publicKey: input.credential.publicKeyCose, counter: input.credential.counter }
});
if (!verified.verified || !verified.authenticationInfo.userVerified) throw new Error("Passkey assertion was not verified.");
```

Also reject a mismatch in returned credential ID or a nonzero counter regression; return only verified facts. The upstream library handles signature, challenge, origin, RP hash, UP/UV, and counter verification; tests must exercise those real checks with signed fixtures, not a mocked verifier.
- [ ] Run the focused test until it passes, then `pnpm test:unit`, `pnpm typecheck:all`, `pnpm lint`, and `pnpm --filter @aurel/web build`. Expected: all exit 0. Record any build warnings separately from failures.
- [ ] Commit Task 1 with `git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/security/action-passkey-assertion.ts apps/web/tests/unit/action-passkey-assertion.test.ts` and a message identifying the disconnected verifier.

## Task 2: Atomically consume an exact challenge and persist one authorization

**Files:**
- Create: `apps/web/src/lib/security/action-passkey-store.ts`
- Create: `apps/web/tests/unit/action-passkey-store.test.ts`
- Modify only if required by a failing test: `infra/d1/migrations/0025_action_passkey_authorization_integrity.sql`

**Interfaces:**
- Consumes: Task 1's verified result, an authenticated Privy subject/session, one server-held `intent_prepared_calls` row, current `security_profiles.policy_version` and lock state, and migration `0024` records.
- Produces: `consumeVerifiedActionPasskey(db, input): Promise<{ authorizationId: string }>` where `input` contains Task 1's verified result plus server-read `challengeId`, `challengeDigest`, `subjectReference`, `sessionReference`, `intentId`, `stepIndex`, `callFingerprint`, `policyVersion`, `rpId`, `origin`, and server time. `credentialId` and `newCounter` come only from the verified result, never from an unsigned browser-declared approval flag.

The critical SQL shape is a conditional update of the one stored challenge followed immediately, within one D1 transaction, by an evidence insert that depends on that update. Bind every named value with D1 placeholders; do not interpolate customer values into SQL.

```sql
UPDATE action_passkey_challenges SET consumed_at = ?
WHERE challenge_id = ? AND challenge_digest = ? AND subject_reference = ?
  AND session_reference = ? AND purpose = 'intent_step' AND intent_id = ?
  AND step_index = ? AND call_fingerprint = ? AND policy_version = ?
  AND rp_id = ? AND origin = ? AND consumed_at IS NULL
  AND created_at <= ? AND expires_at > ?
  AND EXISTS (SELECT 1 FROM security_profiles p WHERE p.subject_reference = action_passkey_challenges.subject_reference
    AND p.account_locked = 0 AND p.policy_version = action_passkey_challenges.policy_version)
  AND EXISTS (SELECT 1 FROM intent_prepared_calls c WHERE c.intent_id = action_passkey_challenges.intent_id
    AND c.step_index = action_passkey_challenges.step_index AND c.subject_reference = action_passkey_challenges.subject_reference
    AND c.call_fingerprint = action_passkey_challenges.call_fingerprint AND c.expires_at > ?);
```

```sql
INSERT INTO action_passkey_authorizations
  (authorization_id, challenge_id, credential_id, subject_reference, purpose, intent_id, step_index,
   call_fingerprint, policy_version, authorized_at, expires_at)
SELECT ?, challenge_id, ?, subject_reference, purpose, intent_id, step_index,
       call_fingerprint, policy_version, ?, expires_at
FROM action_passkey_challenges WHERE challenge_id = ? AND changes() = 1;
```

- [ ] Write SQLite-backed tests that seed migration `0024`, a reviewed intent, an immutable prepared call, one active credential, and an unconsumed challenge. Test valid one-use consumption, replay, simultaneous consumption, expired challenge, changed session/subject/purpose/intent/step/fingerprint/origin/RP/policy, credential revocation, account lock, and a changed or missing prepared call. Assert that every rejection leaves zero authorization rows.
- [ ] Run `pnpm --filter @aurel/web exec vitest run tests/unit/action-passkey-store.test.ts`. Expected: tests fail because the store does not exist.
- [ ] Implement a single D1 `batch` transaction containing a conditional credential-counter update (when the authenticator reports a nonzero counter), the conditional challenge consume above (also requiring the active subject-owned credential), and the evidence insert above. Inspect each D1 result's `meta.changes`; reject unless exactly one challenge and one authorization row were written. If D1/SQLite cannot prove the `changes()` dependency within one transaction, add a narrowly scoped trigger in migration `0025` and retest rather than accepting a two-call race.
- [ ] Run the focused tests and `pnpm test:recovery` against isolated local D1. Expected: exactly one authorization survives concurrent calls; backup/restore retains it; no rejected attempt creates one. Then run unit, typecheck, lint, and web build.
- [ ] Commit Task 2 with its store, tests, and any required migration/recovery-drill change.

Task 2 also updates `docs/operations/production-readiness-2026-09-23.md` and `apps/docs/src/content/docs/safety/security-model.md` to state that registration, bootstrap/recovery, server-trusted simulation, exact production origin/RP, wallet-wide policy claims, and independent security review remain required. Before finishing, rerun the existing Aave execution, policy relaxation, and high-value intent tests; the new modules must not be imported by those public routes. Request independent security review of both tasks and fix every Critical/Important finding. Do not deploy this plan without migration ordering and explicit operator acceptance.

## Follow-on activation plan, intentionally separate

This foundation does not implement registration, bootstrap or recovery, policy relaxation, exact-action review UI, server-trusted transaction simulation, or wallet-level co-signing. Those are separate connected-flow tasks under the approved design. They require the exact custom production domain and a reviewed recovery/incident procedure before enrollment or money movement can be activated. The current Worker and production D1 remain unchanged by executing this local plan.
