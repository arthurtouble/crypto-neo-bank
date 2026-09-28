---
title: Internal security review
description: Current findings, accepted risks, mitigations, and release conclusion.
---

> **Update 25 September 2026:** the private-beta invitation gate was removed. Findings about invitation codes, cohorts, country gating, and beta transaction caps no longer apply; open access relies on feature switches, account locks, and daily limits ([launch controls](../operations/launch-controls.md)). Later on 25 September, money movement moved to the [money actions](../architecture/money-actions.md) pipeline and provider webhooks moved to per-provider endpoints; the controls list below reflects that. The rest of this review is unchanged.

Reviewed 22 September 2026. Scope: application authentication, private-beta access, transaction preparation, provider events, data authority, operational recovery, Cloudflare configuration and release controls. This is an internal engineering review, not the independent review required for public launch.

## Positive controls verified in code

- Protected APIs derive the customer subject from a server-verified Privy access token.
- Operations access denies everyone unless an exact Privy subject is configured.
- Aurel cannot independently sign customer wallet transactions.
- Actions are prepared server-side as exact calls; approvals are exact and batched with the action.
- The verifier requires decoded calls to equal prepared calls, finality, expected events, and cross-chain delivery before `confirmed`.
- Actions keep forward-only status transitions and append-only evidence.
- Provider events are verified per provider (Bridge RSA, Privy Svix, Stripe HMAC-SHA256 with a 5-minute tolerance), with replay protection and idempotent processing.
- Card details are shown only inside Stripe's Issuing Elements frames, with a 15-minute ephemeral key bound to the card and a browser nonce, issued after a fresh passkey confirmation. Aura never receives the card number. Unfreezing a card and raising its daily limit need the same step-up; unfreezing is refused while the account is locked.
- Queue failures reach a dead-letter queue and a critical issue; scheduled reconciliation runs every five minutes.
- D1 is not treated as authoritative for customer balances or settlement.
- Security headers, abuse limits, structured logs, CI, CodeQL, dependency audit and isolated recovery testing exist.
- Product capabilities have database-backed server-side kill switches, and the public status response exposes only bounded operational state.
- The recovery drill performs a real local backup, clean restore, integrity check and retained-consent verification.

## Open findings

| Severity | Finding | Required closure |
|---|---|---|
| High launch gate | WAF/API rate rules, API Shield and operator Access are not active | Configure after custom domain and operator identity are approved; capture evidence |
| High launch gate | No independent application/security assessment | Independent review with no unresolved critical/high issues |
| Medium | External log retention, alert routing and named incident coverage are unset | Configure receiver/export and exercise notification |
| Medium | Real-wallet acceptance matrix is incomplete | Execute the [acceptance test plan](../operations/acceptance-test-plan.md) with designated funded test wallets |
| Medium | Regulated provider and jurisdiction allocation is unsigned | Contract, counsel and operational tabletop sign-off |
| Moderate accepted for private beta | Two transitive wallet-connector advisories have no safe direct override | Track reachability, upstream remediation and review date in the [dependency risk register](../architecture/dependency-risk-register.md); no High/Critical advisories are open |
| Low | Public Worker hostname remains the production hostname | Attach approved custom domain and update origin/API schemas |

## Threat assumptions

Customer device compromise, malicious wallet extensions, exported-key use outside Aurel, protocol bugs, bridge failure, oracle failure, chain reorganization and provider insolvency cannot be eliminated by interface controls. Documentation must preserve these boundaries. Product locks govern only instructions prepared through Aurel.

## Release verdict

Suitable for continued invite-only engineering and acceptance testing with small designated funds. Not approved for broad public launch or regulated fiat/card activation until every high launch gate is closed and the accountable owner records evidence in [launch readiness](../overview/launch-readiness.md).
