---
title: Growth operations runbook
description: Operating the global waitlist, invitations, consent, and release gate.
---

The [original growth implementation specification](/growth/marketing-growth-implementation-spec/) is historical and superseded for the public flow. The current landing uses an email-only waitlist. The waitlist does not grant product access. `beta_invites` and `beta_access` remain authoritative for invitations and access.

## Before opening signups

`GROWTH_WAITLIST_MODE` defaults to `closed`. Do not change it to `open` until these are complete:

- Publish the final privacy notice with controller identity, rights contact, retention period, lawful-basis mapping, and relevant provider details.
- Obtain product/legal approval for the global landing content and geographic claims; keep the marketing register in `pending` until signed off.
- Configure and test distinct `GROWTH_EMAIL_ENCRYPTION_KEY` and `GROWTH_EMAIL_LOOKUP_KEY` secrets, Turnstile, rate limiting, D1, and deletion/export handling for people without accounts.
- Assign an operator to review invitations and an incident owner for the signup path.
- Configure and verify a delivery process that sends each one-use bearer code only to the intended waitlist email. The current operator view reveals a code but does not send it or bind redemption to that email; keep signups closed until recipient assurance is operational.
- Run unit, browser, accessibility, docs, build, and marketing checks against the release candidate.

The required privacy notice version is set by `GROWTH_PRIVACY_NOTICE_VERSION`. An outdated form version is rejected. The public success response does not reveal whether an email was already present.

## Daily operation

1. Review the protected waitlist queue. Decrypted email is visible only to authorized operations admins.
2. Treat the Cloudflare country hint as approximate. It is not proof of residence or eligibility.
3. Check the prospective member's country through the approved process. Record the two-letter verified country and a non-sensitive evidence reference.
4. Issue a one-use invitation only when that country is enabled by `GROWTH_ALLOWED_COUNTRIES` and capacity and product gates allow it. Copy the code once; only its hash is stored.
5. Send the code through the approved contact process. The local adapter does not send invitation or confirmation email automatically.

An invitation does not override the authenticated product's terms, geography, suspension, or feature gates. Do not use the IP country hint as the `verifiedCountry` field.

## Campaigns, events, and referrals

Campaign links point to `/waitlist` and may carry bounded source labels. The browser can send allowlisted landing/waitlist events; invitation and access facts are server-owned. Reports should remain aggregate and must not expose email or balances.

`GROWTH_REFERRALS_ENABLED` stays false. The old application-qualification/activation step no longer exists, so enabling referrals requires a separate approved redemption path. A disabled referral code must not be described as usable access.

## Data rights and retention

Authenticated members can submit growth-data requests in Settings. Before opening the waitlist, publish a contact route for a person who only supplied an email and establish a secure identity-verification and deletion/export procedure. Never use a public email lookup response that confirms whether someone is on the waitlist. Retain necessary invitation and audit evidence under the approved schedule; do not delete financial or onchain authority records as part of a growth request.

## Deployment and rollback

Apply the fresh `0008_growth_distribution.sql` schema before deploying code that reads the waitlist. This is a pre-launch replacement of application-only tables, not a migration of production applicant records. Do not delete an existing local D1 database implicitly.

Deploy with `GROWTH_WAITLIST_MODE=closed`, smoke-test the page and API, complete the release gate, and open signups only with an operator on call. To pause intake, set the mode to `closed`; existing records and product access remain untouched. Disable referrals independently. If operator authorization, encryption, geography checks, or logging are unsafe, roll back the Worker and preserve evidence for investigation.

Never paste email, invite codes, raw IP addresses, tokens, wallet addresses, or eligibility evidence into incident chat or logs.
