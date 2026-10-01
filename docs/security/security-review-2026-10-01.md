---
title: Security review, 1 October 2026
description: Internal source review of the web app, operations app, events Worker, docs, configuration, and dependencies, with the fixes it led to.
---

# Security review, 1 October 2026

Point-in-time evidence. Don't edit; the living record is [security-review.md](security-review.md).

An internal, source-first review at commit `e68071a`, run as five independent reviewers on different models, using the Cloudflare `security-audit` skill's evidence bar (a lower-trust principal, an input, a crossed boundary, and a concrete result). No deployed endpoint was probed. Each confirmed finding was reproduced by a unit test that failed on the old code before it was fixed. This is not the independent review required for public launch ([scope](external-security-review-scope.md)).

## Areas

Sign-in and authorization; the money-action pipeline and its controls; browser and edge; webhooks, the queue consumer, and scheduled jobs; Cloudflare configuration, secrets, CI, dependencies, and data classification.

No reviewer found a way for one customer to read or change another customer's data, or to move money past the server-side controls. No secrets were found in the working tree or git history.

## Findings and fixes

| Severity | Finding | Fix |
|---|---|---|
| High | A reported transaction hash could be bound to any prepared action; binding another customer's relayed hash stalled that action and the shared recheck job | #110: a hash binds only when the chain shows the action's own wallet sent the prepared calls; duplicate hashes are recorded, not thrown; checks are isolated per action |
| Medium | Bank payouts skipped saved-recipients-only and the new-recipient wait; new bank accounts sent no notice | #110: bank accounts get an `available_at` (migration 0005) and a security notice; payouts honor the wait |
| Medium | A Privy relay failure with no hash marked the action failed without chain evidence | #110: stays submitted until the Privy request expires with no hash |
| Medium | Push delivery had no timeout, no per-customer cap, and no claim, so one customer's endpoints could stall delivery | #108: 5 s timeout, 10 browsers per customer, a delivery claim (migration 0004), a 25 s run budget |
| Medium | Every pay page view shared one rate-limit bucket | #108: the lookup is shared and keyed on the visitor's IP |
| Medium | The operations app and docs sent no security headers; operations writes had no cross-site check | #109: headers on every response; writes need a same-origin request and a JSON body |
| Low | Push endpoints accepted any HTTPS host; the data export included push keys; notice links weren't restricted to the app | #108 |
| Low | Lost webhook queue sends weren't retried; body caps trusted `Content-Length`; same-second card updates were order-dependent; an unreadable Bridge timestamp became "now" | #108 |
| Low | The bought asset's pause was checked only at quote time; the reported-hash path skipped lock, switch, and pause checks; a tag's receiving address could change without a passkey | #110 |
| Low | Static files and the 451 JSON lacked the web security headers; provider links weren't checked for https; a `?tag=` label showed before verification | #109 |
| Low | CI actions pinned by tag; two moderate dependency advisories (uuid, decode-uri-component) | #109: pinned by SHA, per-job permissions, overrides |

## Outside the repo (owner)

- The SameSite setting of the Cloudflare Access cookie on the operations app, and Access covering the production operations Worker (including its workers.dev address) before launch.
- Branch protection on `main`, required reviewers on the GitHub `dev` environment, and the scope of the Cloudflare API token used by the dev deploy.
- How long Privy treats a passkey check as fresh for authorization signatures.

## Accepted for now

- The web CSP still allows inline scripts and any HTTPS `connect-src`; tightening needs nonces for the framework's inline scripts.
- Native-token outputs of routes are confirmed from LI.FI's status rather than an observed balance change; this affects the displayed status only.
- The card's on-chain USDC allowance can't be set to zero from the app; freezing and locking act on the card itself.
- No retention or erasure schedule yet for short-lived tables (product events, notifications, step-up challenges).
