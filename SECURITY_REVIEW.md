# Internal security review

Reviewed 22 September 2026. Scope: application authentication, private-beta access, transaction preparation, provider events, data authority, operational recovery, Cloudflare configuration and release controls. This is an internal engineering review, not the independent review required for public launch.

## Positive controls verified in code

- Protected APIs derive the customer subject from a server-verified Privy access token.
- Operations access denies everyone unless an exact Privy subject is configured.
- Aurel cannot independently sign customer wallet transactions.
- Transaction preparation validates allowlisted chain/asset/destination, policy and expected returned transaction fields.
- Direct sends are simulated; route approvals are exact rather than unlimited by default.
- Instructions retain constrained state transitions, policy results and source receipt evidence.
- Provider events require timestamped HMAC authentication, replay protection and idempotent processing.
- Queue failures reach a dead-letter queue and a critical issue; scheduled reconciliation runs every five minutes.
- D1 is not treated as authoritative for customer balances or settlement.
- Security headers, abuse limits, structured logs, CI, CodeQL, dependency audit and isolated recovery testing exist.
- Invitation codes are returned only at creation and stored as hashes; country, cohort and transaction-cap policy is enforced server-side.
- Product capabilities have database-backed server-side kill switches, and the public status response exposes only bounded operational state.
- The recovery drill performs a real local backup, clean restore, integrity check and retained-consent verification.

## Open findings

| Severity | Finding | Required closure |
|---|---|---|
| High launch gate | WAF/API rate rules, API Shield and operator Access are not active | Configure after custom domain and operator identity are approved; capture evidence |
| High launch gate | No independent application/security assessment | Independent review with no unresolved critical/high issues |
| Medium | External log retention, alert routing and named incident coverage are unset | Configure receiver/export and exercise notification |
| Medium | Real-wallet acceptance matrix is incomplete | Execute `ACCEPTANCE_TEST_PLAN.md` with designated funded test wallets |
| Medium | Regulated provider and jurisdiction allocation is unsigned | Contract, counsel and operational tabletop sign-off |
| Moderate accepted for private beta | Two transitive wallet-connector advisories have no safe direct override | Track reachability, upstream remediation and review date in `DEPENDENCY_RISK_REGISTER.md`; no High/Critical advisories are open |
| Low | Public Worker hostname remains the production hostname | Attach approved custom domain and update origin/API schemas |

## Threat assumptions

Customer device compromise, malicious wallet extensions, exported-key use outside Aurel, protocol bugs, bridge failure, oracle failure, chain reorganization and provider insolvency cannot be eliminated by interface controls. Documentation must preserve these boundaries. Product locks govern only instructions prepared through Aurel.

## Release verdict

Suitable for continued invite-only engineering and acceptance testing with small designated funds. Not approved for broad public launch or regulated fiat/card activation until every high launch gate is closed and the accountable owner records evidence in `LAUNCH_READINESS.md`.
