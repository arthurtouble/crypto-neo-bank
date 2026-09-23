# Pending Passkey Possession Proof

The disconnected `action-passkey-possession` service verifies that a newly registered **pending** credential can sign a fresh WebAuthn challenge. It does not make that credential active or permit a transfer, Swap, policy change, or wallet signature.

For an eligible, unlocked beta subject, the issuer creates a two-minute, user-verified authentication challenge restricted to one pending credential and the exact configured HTTPS origin/RP ID. D1 stores its digest, subject, session, credential-ID digest, purpose, origin, RP ID, and expiry—not the challenge itself. The completion service loads the immutable public key and current counter from D1, verifies the signed assertion against that key and challenge, then atomically consumes the matching challenge, advances the counter, and records an audit event. It rechecks pending status, account lock, beta eligibility, subject/session, credential, origin/RP, and expiry at consumption. Replay and concurrent completion have one winner. A production Worker host is rejected as an RP ID.

Possession is only one prerequisite for activation. First-credential bootstrap, recovery assurance, the final custom production domain, operator review, and independent security assessment remain unresolved. No customer route imports this service. An ordinary Privy session and this possession proof together must not activate a credential without those separate gates.

The assertion flow follows [SimpleWebAuthn's server authentication guide](https://simplewebauthn.dev/docs/packages/server) and the [WebAuthn verification model](https://www.w3.org/TR/webauthn/).
