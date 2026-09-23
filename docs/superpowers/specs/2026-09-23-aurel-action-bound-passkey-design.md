# Action-Bound Step-Up for Aurel

Date: 2026-09-23  
Status: Proposed; customer approval and production-domain decision pending

## Decision to make

Privy's MFA enrollment protects account access but does not give Aurel's server a verifiable proof that the customer approved one exact transfer, Swap, Aave call, or policy change. Aurel therefore currently rejects high-value preparation with `step_up_unavailable`. The proposed solution is a separate Aurel-owned WebAuthn credential, used only as a one-use signature over an exact reviewed action. This is an application authorization layer; it does not prevent a customer from using a self-custody wallet outside Aurel. Wallet-wide enforcement would require a separately reviewed Privy signer policy or quorum design.

The product-wide threshold remains at or below $10,000 regardless of a customer's stored preference. Lower customer thresholds remain effective. Other policy relaxations currently remain an open release gate.

## Registration and recovery

- Use a stable custom Aurel HTTPS domain and RP ID **before** production enrollment. A credential registered to the current `workers.dev` host will not silently migrate to an unrelated custom RP ID.
- Registration needs a fresh, random server challenge, verified Privy subject/session, exact expected origin/RP, user verification, attestation/public-key validation, and a subject-scoped credential record. Store public key, credential ID, algorithm, RP ID, counter/risk metadata, created/revoked times, and audit event; never a private key.
- First enrollment is not enough to loosen controls: a compromised ordinary email/Privy session could enroll an attacker's credential. Require an approved bootstrap/recovery assurance path with cooling, notification, and operator review where needed. Recovery revokes old credentials and outstanding challenges; email alone cannot immediately unlock or raise limits.
- Enrollment and recovery are not account balances or wallet custody. D1 stores durable security controls and audit evidence, so those tables require backup and restoration testing even though portfolio projections are disposable.

## Exact-action assertion

For a financial call, create the immutable prepared call only after current authentication, eligibility, wallet ownership, valuation, policy, quote, and simulation checks. If step-up is required, mark it `awaiting_step_up`; it is not signable. Generate a short-lived random challenge bound server-side to subject, session, intent ID, step index, call fingerprint, policy version, expiry, and purpose. Browser WebAuthn uses `userVerification: required` and returns an assertion.

The server verifies the challenge, exact allowed origin, RP ID hash, user presence and verification flags, signature against a credential owned by the subject, counter/risk signal, and current lock/eligibility/policy/expiry. Atomically consume the challenge and authorize only that stored call. Replays or parallel use fail; an idempotent retry can return the same authorization but cannot authorize another fingerprint. Recheck the current policy and call immediately before Aurel asks Privy to submit. Approval, source Swap, destination-required route, and each Aave step have independent challenges.

For security-policy relaxation, bind a different challenge purpose to the exact proposed field diff and current policy version. An atomic compare-and-set update consumes the assertion only if the stored policy version is unchanged. Relaxations include unlock, disabling allowlist, increasing spending/new-address/step-up limits, shortening cooling, and adding an allowed destination. Tightening/removing destinations may remain immediate. Never use a reusable “MFA completed recently” account flag as authority.

## Threat and release checks

Tests must cover wrong origin/RP, subject/session/intent/step substitution, changed calldata or amount, UV absent, malformed signature, replay and concurrent consume, expiry, counter anomalies, policy/eligibility/lock change after challenge, stale policy version, multiple steps, cancelled/replaced transaction, first-enrollment takeover, credential revocation, and recovery. Use real Workers/D1-compatible WebCrypto and a SQLite-backed atomicity test, plus desktop/mobile passkey journeys on the final domain. An independent security assessment is required before enabling high-value signing or policy relaxation.

This design follows the [W3C WebAuthn specification](https://www.w3.org/TR/webauthn/) and [Cloudflare D1 transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/). Privy [authentication](https://docs.privy.io/authentication) and [wallet authorization controls](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls/) remain distinct from Aurel's action-bound proof.
