---
title: Growth operations runbook
description: Configuration, operation, retention, security, tests, rollback, and incident handling for the private-access growth system.
---

This runbook implements the [growth specification](/growth/marketing-growth-implementation-spec/) without changing Aurel’s financial-authority model. Provider and chain facts remain authoritative for balances and settlement. `beta_invites` and `beta_access` remain authoritative for product access. Growth tables hold applications, attribution, lifecycle evidence, aggregate reporting, and operational decisions only.

## Configuration

Non-secret Worker variables:

- `GROWTH_APPLICATION_MODE`: `closed`, `open`, or `paused`;
- `GROWTH_ALLOWED_COUNTRIES`: comma-separated ISO country codes used only at invitation time;
- `GROWTH_PRIVACY_NOTICE_VERSION` and `GROWTH_APPLICATION_VERSION`: exact versions accepted by the API;
- `GROWTH_REFERRALS_ENABLED`: false until the 30-day rule has mature server evidence;
- `GROWTH_REFERRAL_LIMIT` and `GROWTH_REFERRAL_EXPIRY_DAYS`.

Distinct Worker secrets are required for `GROWTH_EMAIL_ENCRYPTION_KEY` and `GROWTH_EMAIL_LOOKUP_KEY`. Production fails closed if either is missing. Do not reuse the lookup key for encryption. Rotate through an approved migration because existing encrypted values and HMAC lookup values depend on the active keys.

## Daily operation

1. Review the inbox by age, then country and primary job.
2. Open an application only when needed; detail access is audited.
3. Move `received` to `reviewing`, assign an operator, and record an approved reason for a decline or reopen.
4. Treat `fit_band` as operator workflow judgment, never regulated eligibility or suitability.
5. Invite only `qualified` or `waitlisted` applications in an enabled country. The code is returned once and only its hash is stored.
6. Review funnel denominators and guardrails together. Never use AUM as a growth leaderboard.
7. Keep small cohort breakdowns suppressed below five submissions.

The country allowlist is checked again when an invite is issued. Application collection and product access are separate: an unsupported-country application may be retained or waitlisted but cannot receive an invitation.

## Identity and event chain

The linkage is server controlled:

`session UUID -> application -> hashed invite -> verified Privy subject`

The public event endpoint accepts only landing, tour, and application-start events with bounded properties. Server facts such as qualification, invitation, first value, and retention cannot be posted by the browser. The scheduled event Worker materializes milestones from verified subject profiles, security-policy updates, confirmed transaction intents, and meaningful day 21–37 return activity. Rule versions are stored in event properties and retention runs.

## Communications and consent

The lifecycle layer is vendor-neutral and defaults to a local test adapter. No delivery vendor should be activated before DPA, residency, suppression, signing, sender-domain, and pricing review. Each message requires matching active consent, a versioned template, an idempotency key, and an audit record. Marketing is capped and blocked when access is restricted. Operational messages must not carry unrelated marketing.

Customers can withdraw optional marketing consent in Settings. Operational application contact and optional marketing remain distinct. A withdrawn purpose blocks later sends.

## Referrals

Referrals are feature-flagged off initially. Eligibility is evaluated only from server records: active access, account-security milestone, confirmed first value, mature retention, no open critical issue, enabled country, capacity, and active-invite cap. A created referral is stored as a disabled beta invitation. The referred person submits the normal application; an operator qualifies the application before activating the original one-use code. Self-referral checks run during redemption. No financial reward accounting is included.

## Data rights and retention

Authenticated customers may request export or deletion. Operators process requests in the growth data-request queue. Export includes application, lifecycle, communication, consent, and retention evidence. Deletion removes or disconnects growth application and analytics records while deliberately leaving `beta_access`, transaction intents, provider projections, and financial authority untouched. Audit and legally required evidence follow the separate retention schedule.

Scheduled retention evaluation is idempotent per subject and rule version. Do not mark route views as retained. Campaign reports are aggregate and must not expose identity or balances.

## Deployment and migration

Apply `0008_growth_distribution.sql` before deploying code that reads growth tables. Verify it against an empty local database and a current-schema database. Then run typecheck, lint, unit tests, browser E2E on desktop and mobile, build, recovery drill, marketing claims check, public docs build, and internal KB build.

Required order:

1. database migration;
2. encryption and lookup secrets;
3. Worker and scheduled consumer deployment;
4. smoke tests while application mode is `paused`;
5. set mode `open` only after privacy/copy/operator review.

## Rollback

Set `GROWTH_APPLICATION_MODE=paused` first. This stops durable public submissions without changing existing access. Roll back the web Worker if application, operator, or public-event behavior is unsafe. Disable referrals independently. The migration is additive; do not drop growth tables during an incident. Preserve application, consent, invitation linkage, and audit evidence until recovery and legal review are complete.

Rollback must never delete or mutate `beta_access`, provider projections, transaction intents, security policies, or chain/provider authority.

## Incident checks

Pause growth traffic for missing privacy secrets, unexpected plaintext email, invitation disclosure, operator authorization failure, consent bypass, campaign identifier injection, cross-site identity linkage, incorrect country gating, or event spoofing. Use trace IDs and audit events; never paste email, free text, invite codes, tokens, wallet addresses, or IP addresses into incident chat or logs.
