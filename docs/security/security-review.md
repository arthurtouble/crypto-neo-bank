---
title: Internal security review
description: Current findings, accepted risks, mitigations, and release conclusion.
---

Reviewed 22 September 2026: application authentication, access, transaction preparation, provider events, data authority, operational recovery, Cloudflare configuration, and release controls. This is an internal engineering review, not the independent review required for public launch ([scope](external-security-review-scope.md)).

Later changes reflected below: on 25 September 2026 the private-beta invitation gate was removed, so findings about invitation codes, cohorts, country gating, and beta transaction caps no longer apply (open access relies on feature switches, account locks, and daily limits, see [launch controls](../operations/launch-controls.md)); money movement moved to the [money actions](../architecture/money-actions.md) pipeline; and provider webhooks moved to per-provider endpoints. On 28 September operator access moved to a separate operations app behind Cloudflare Access, with the token verified by the web app.

## Controls verified in code

- Protected APIs derive the customer subject from a server-verified Privy access token.
- Operator APIs (`/api/ops/*`) accept only a Cloudflare Access token the web app verifies itself (`lib/auth/access.ts`: signature, issuer, audience, expiry, a person's email; [details](../architecture/architecture.md#operations-app)). Service tokens and customer Privy sessions are refused; with no Access configuration, every operator request is refused. Every change records the operator's email.
- Aura can't sign customer wallet transactions on its own.
- Actions are prepared server-side as exact calls; approvals are exact and batched with the action.
- The verifier requires decoded calls equal to prepared calls, finality, expected events, and cross-chain delivery before `confirmed`.
- Actions have forward-only status transitions and append-only evidence.
- Provider events are verified per provider ([provider projections](../architecture/provider-projections.md)), with replay protection and idempotent processing.
- Card details show only inside Stripe's Issuing Elements frames, with a 15-minute ephemeral key bound to the card and a browser nonce, after a fresh passkey confirmation. Aura never receives the card number. Unfreezing and raising the daily limit need the same step-up; unfreezing is refused while the account is locked.
- Queue failures reach a dead-letter queue and a critical issue; scheduled reconciliation runs every five minutes.
- D1 is not authoritative for customer balances or settlement.
- Security headers, abuse limits, structured logs, CI, CodeQL, dependency audit, and isolated recovery testing exist. All three web surfaces send a CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, a referrer policy, and HSTS: the customer app on every response, including static files and the 451 answers (`apps/web/src/lib/http/security-headers.ts`, `apps/web/public/_headers`); the operations app's Worker on every response, with a CSP of `'self'` only; the docs through `apps/docs/public/_headers`, with inline scripts and styles allowed because Starlight emits them.
- The operations Worker refuses writes that don't come from its own page (`Sec-Fetch-Site: same-origin`, or a matching `Origin` when the browser sends no fetch metadata) and bodies that aren't JSON, so a cross-site request carrying an Access cookie can't change a switch, lock, or note.
- GitHub Actions are pinned by commit SHA with the version in a trailing comment (update them together, on purpose), and each `security.yml` job lists its own permissions.
- The provider-event consumer has no public `workers.dev` address in production. A link from a provider that goes to a page is opened only if it is https.
- Product capabilities have database-backed server-side kill switches. The public status and incident routes were removed on 28 September 2026; `GET /api/health` reports only whether the database, queue, and sign-in are configured.
- The recovery drill does a real local backup, clean restore, integrity check, and retained-consent verification.

## Open findings

| Severity | Finding | Required closure |
|---|---|---|
| High launch gate | WAF/API rate rules and API Shield are not active. Cloudflare Access protects the dev operations app (`aura-dev-ops`, 28 September 2026) but not production yet | Turn on Access for the production operations Worker and set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` there; configure the rest after the custom domain is approved; capture evidence |
| High launch gate | No independent application/security assessment | Independent review with no unresolved critical/high issues |
| Medium | External log retention, alert routing, and named incident coverage are unset | Configure receiver/export and exercise notification |
| Medium | Real-wallet acceptance matrix is incomplete | Run the [acceptance test plan](../operations/acceptance-test-plan.md) with designated funded test wallets |
| Medium | Regulated provider and jurisdiction allocation is unsigned | Contract, counsel, and operational tabletop sign-off |
| Moderate, accepted | Two transitive wallet-connector advisories have no safe direct override | Track in the [dependency risk register](../architecture/dependency-risk-register.md); no High/Critical advisories are open |
| Low | Public Worker hostname is still the production hostname | Attach the approved custom domain and update origin/API schemas |

## Threat assumptions

Interface controls can't eliminate customer device compromise, malicious wallet extensions, exported-key use outside Aura, protocol bugs, bridge or oracle failure, chain reorganization, or provider insolvency. Documentation must keep these boundaries ([threat model](threat-model.md#explicit-non-goals)). Product locks govern only instructions prepared through Aura.

## Release verdict

Suitable for continued engineering and acceptance testing on dev, with small designated funds. Not approved for broad public launch or regulated fiat/card activation until every high launch gate is closed and the accountable owner records evidence in [launch readiness](../overview/launch-readiness.md).
