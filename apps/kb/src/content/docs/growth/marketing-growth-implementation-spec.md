---
title: Marketing and growth implementation specification
description: Buildable growth features, data models, APIs, controls, and acceptance tests.
---

Date: 22 September 2026  
Audience: implementation agent, product owner, security reviewer, and growth owner  
Related plan: [Go-to-market and growth plan](/growth/go-to-market-and-growth-plan/)

This document converts the go-to-market plan into buildable features. It follows the existing architecture: Next/vinext on Cloudflare Workers, D1 for operational evidence and non-authoritative data, Privy authentication, Turnstile, explicit operations authorization, and fail-closed beta access.

The growth system must never become a financial ledger, infer eligibility, grant product access by itself, or place marketing convenience ahead of privacy and security.

---

## 1. Delivery order

### Required before marketing traffic

| ID | Feature | Priority | Size | Depends on |
|---|---|---:|---:|---|
| GROW-001 | Qualified private-access application | P0 | L | Approved copy, privacy/consent version |
| GROW-002 | First-party attribution capture | P0 | M | GROW-001 |
| GROW-003 | Public growth-event collection | P0 | M | D1 migration, Turnstile/rate-limit conventions |
| GROW-004 | Growth operations queue | P0 | L | GROW-001–003 |
| GROW-005 | Application-to-invitation workflow | P0 | M | GROW-004, existing beta invites |
| GROW-006 | Marketing-ready landing page and product tour | P0 | M | Approved claims, GROW-001 |
| GROW-007 | Acquisition and activation dashboard | P0 | L | GROW-001–005 |
| GROW-008 | Claims registry and automated copy checks | P0 | M | Legal/compliance owner |

### Required during the first 25-user cohort

| ID | Feature | Priority | Size | Depends on |
|---|---|---:|---:|---|
| GROW-009 | Lifecycle communication adapter and consent controls | P1 | L | Provider selection, GROW-001 |
| GROW-010 | Customer referral invitations | P1 | L | Activation definition, GROW-005 |
| GROW-011 | Partner and content campaign tracking | P1 | M | GROW-002–003 |
| GROW-012 | Experiment registry and cohort comparisons | P1 | M | GROW-007 |
| GROW-013 | Structured interview and research repository | P1 | S | GROW-004 |
| GROW-014 | Data export, deletion, and retention controls | P1 | M | GROW-001–003, retention approval |

### Valuable after acquisition repeatability

| ID | Feature | Priority | Size | Depends on |
|---|---|---:|---:|---|
| GROW-015 | Privacy-first wallet/treasury checkup | P2 | XL | Separate legal/security review |
| GROW-016 | Shareable transaction/risk receipt | P2 | L | Existing simulations/policies |
| GROW-017 | Grounded content operations assistant | P2 | L | Claims registry and source controls |
| GROW-018 | Referral reward accounting | P2 | M | Unit economics and approved reward policy |

Size is relative: S is a focused change, M is a multi-file feature, L is a full vertical slice, and XL requires a separate design and threat model. It is not a calendar estimate.

---

## 2. Product-wide implementation rules

1. D1 may store applications, attribution, consent, invitations, experiments, and operational evidence. It must not become an authoritative balance, settlement, or suitability system.
2. Public endpoints are deny-by-default, schema-validated, rate-limited, bot-protected where they create durable records, and return a trace ID.
3. Operator endpoints must use `requireOperationsAdmin`; production should additionally require Cloudflare Access.
4. Public responses must not reveal whether an email address has already applied, been invited, or has a product account.
5. Do not log email addresses, free-text applications, wallet addresses, invite codes, Turnstile tokens, access tokens, or full IP addresses.
6. Do not use browser fingerprinting. Before consent/application submission, keep UTMs in session storage. Persist them only when the person submits the application under the disclosed privacy purpose.
7. Use an HMAC lookup value for normalized email deduplication, not an unsalted SHA-256 hash. Store contact email encrypted with an application-specific nonce and a Workers secret.
8. Marketing consent and private-beta operational contact must be distinct purposes. Access must not depend on optional marketing consent.
9. Every operator status change, invitation, claim approval, communication, export, and deletion must write an `audit_events` record.
10. All date-times use ISO 8601 UTC. Country codes use uppercase ISO 3166-1 alpha-2.
11. All growth features require responsive, keyboard-accessible UI and tests at mobile and desktop sizes.
12. No marketing feature may enable a financial product, change a transaction limit, or override geography/provider eligibility.

---

## 3. Data model

Create a new migration after `0007_provider_customer_links.sql`, tentatively:

`infra/d1/migrations/0008_growth_distribution.sql`

Names below are the intended contract. The implementation agent may adjust SQL syntax but should preserve the semantics.

### `growth_applications`

One record per private-access application.

| Column | Type | Rules |
|---|---|---|
| `application_id` | TEXT | UUID primary key |
| `email_ciphertext` | TEXT | encrypted normalized email; never returned in list endpoints unless operator explicitly opens the application |
| `email_nonce` | TEXT | unique encryption nonce/IV |
| `email_lookup_hmac` | TEXT | unique HMAC for deduplication |
| `country_code` | TEXT | two uppercase characters |
| `primary_job` | TEXT | `receive`, `see`, `protect`, `earn`, `spend`, `move`, `treasury`, `other` |
| `workflow_frequency` | TEXT | `daily`, `weekly`, `monthly`, `occasional`, `not_yet` |
| `asset_band` | TEXT nullable | `under_25k`, `25k_100k`, `100k_500k`, `over_500k`, `prefer_not_to_say` |
| `relationship_type` | TEXT | `individual`, `family`, `company` |
| `wallets_chains_json` | TEXT | bounded array of approved option identifiers, not wallet addresses |
| `desired_outcome` | TEXT | 10–500 characters; treat as sensitive free text |
| `status` | TEXT | `received`, `reviewing`, `qualified`, `waitlisted`, `invited`, `declined`, `withdrawn` |
| `fit_band` | TEXT nullable | `high`, `medium`, `low`; operator judgment, not automated eligibility |
| `assigned_to` | TEXT nullable | operator subject reference |
| `decision_reason` | TEXT nullable | approved reason code, not unbounded sensitive notes |
| `source_application_version` | TEXT | form/copy version |
| `privacy_notice_version` | TEXT | accepted notice version |
| `beta_contact_consent` | INTEGER | required operational contact permission |
| `marketing_consent` | INTEGER | optional and independent |
| `submitted_at` | TEXT | required |
| `reviewed_at` | TEXT nullable | set on first decision |
| `updated_at` | TEXT | required |

Indexes:

- unique `email_lookup_hmac`;
- `(status, submitted_at DESC)`;
- `(country_code, status, submitted_at DESC)`;
- `(primary_job, status, submitted_at DESC)`.

Do not store the applicant's IP. If abuse controls require an IP-derived key, HMAC it with a rotating abuse secret and store it only in the existing bounded rate-limit mechanism.

### `growth_attribution`

Store the attribution submitted with the application or attached later to a known subject.

| Column | Type | Rules |
|---|---|---|
| `attribution_id` | TEXT | UUID primary key |
| `application_id` | TEXT nullable | foreign key |
| `subject_reference` | TEXT nullable | set only after authenticated linkage |
| `anonymous_session_id` | TEXT nullable | client-generated UUID in session storage |
| `touch_type` | TEXT | `first`, `last`, `conversion` |
| `utm_source` | TEXT nullable | max 100 |
| `utm_medium` | TEXT nullable | max 100 |
| `utm_campaign` | TEXT nullable | max 120 |
| `utm_content` | TEXT nullable | max 120 |
| `utm_term` | TEXT nullable | max 120 |
| `referrer_host` | TEXT nullable | hostname only; discard path/query |
| `landing_path` | TEXT | same-origin path only |
| `partner_code` | TEXT nullable | normalized slug |
| `content_id` | TEXT nullable | registered content identifier |
| `captured_at` | TEXT | required |

At least one of `application_id` or `subject_reference` must be present when persisted. Do not create a cross-site identity graph.

### `growth_events`

Top-of-funnel and lifecycle events that cannot be represented by the authenticated `product_events` table.

| Column | Type | Rules |
|---|---|---|
| `event_id` | TEXT | UUID primary key |
| `application_id` | TEXT nullable | foreign key |
| `subject_reference` | TEXT nullable | only after authenticated linkage |
| `anonymous_session_id` | TEXT nullable | session UUID |
| `event_name` | TEXT | allowlisted server-side |
| `surface` | TEXT | same-origin normalized path or named surface |
| `campaign_id` | TEXT nullable | foreign key |
| `content_id` | TEXT nullable | foreign key or validated identifier |
| `properties_json` | TEXT | allowlisted keys and primitive values only |
| `occurred_at` | TEXT | server timestamp; do not trust client time |

Initial event allowlist:

- `landing_viewed`
- `product_tour_viewed`
- `application_started`
- `application_submitted`
- `application_qualified`
- `application_declined`
- `invite_issued`
- `invite_redeemed`
- `onboarding_started`
- `account_secured`
- `wallet_ready`
- `live_balance_viewed`
- `first_value_completed`
- `retained_30d`
- `referral_unlocked`
- `referral_issued`
- `referral_redeemed`

Never accept arbitrary event names or property keys from a public client.

### `growth_invite_links`

Connect the existing hashed beta invitation to its acquisition source without changing access authority.

| Column | Type | Rules |
|---|---|---|
| `invite_hash` | TEXT | primary key and foreign key to `beta_invites.code_hash` |
| `application_id` | TEXT nullable | originating application |
| `campaign_id` | TEXT nullable | partner/content campaign |
| `referrer_subject_reference` | TEXT nullable | for customer referral only |
| `invitation_type` | TEXT | `operator`, `partner`, `customer_referral` |
| `issued_by` | TEXT | operator subject |
| `issued_at` | TEXT | required |

The existing `beta_invites` and `beta_access` tables remain authoritative for access. This table is attribution only.

### `growth_campaigns`

| Column | Type | Rules |
|---|---|---|
| `campaign_id` | TEXT | UUID primary key |
| `slug` | TEXT | unique, URL-safe |
| `name` | TEXT | operator-facing |
| `campaign_type` | TEXT | `founder`, `partner`, `content`, `creator`, `event`, `paid`, `referral` |
| `partner_label` | TEXT nullable | no contract-sensitive data |
| `approved_countries_json` | TEXT | array |
| `status` | TEXT | `draft`, `active`, `paused`, `closed` |
| `starts_at` | TEXT nullable | |
| `ends_at` | TEXT nullable | |
| `created_by` | TEXT | operator subject |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |

### `growth_experiments`

| Column | Type | Rules |
|---|---|---|
| `experiment_id` | TEXT | UUID primary key |
| `name` | TEXT | unique human label |
| `hypothesis` | TEXT | bounded text |
| `primary_metric` | TEXT | allowlisted metric identifier |
| `guardrails_json` | TEXT | bounded JSON |
| `status` | TEXT | `draft`, `running`, `stopped`, `completed` |
| `starts_at`, `ends_at` | TEXT nullable | |
| `created_by` | TEXT | operator subject |
| `created_at`, `updated_at` | TEXT | |

### `growth_experiment_assignments`

Assignment is server-side and sticky. Do not assign experiments that alter risk disclosure, legal terms, access eligibility, security controls, fees, or transaction confirmation.

| Column | Type | Rules |
|---|---|---|
| `experiment_id` | TEXT | composite primary key |
| `assignment_key` | TEXT | composite primary key; opaque session/application/subject key |
| `variant` | TEXT | validated against the experiment definition |
| `assigned_at` | TEXT | |

### `growth_research_notes`

For interview evidence only. This is not a CRM replacement.

- `research_id`, `application_id` nullable, `segment`, `interviewed_at`, `researcher`, `problem_codes_json`, `objection_codes_json`, `current_tools_json`, `willingness_band`, `summary`, `consent_to_quote`, `created_at`.
- Keep summaries under 2,000 characters.
- Never store identity documents, financial account numbers, wallet seed material, or unredacted call transcripts.

### `growth_communications`

An evidence log, not the delivery provider's source of truth.

- `communication_id`, `application_id`/`subject_reference`, `purpose`, `template_key`, `template_version`, `provider_reference`, `status`, `sent_at`, `delivered_at`, `failed_at`, `failure_code`, `created_at`.
- Never store full email bodies after sending; store the immutable template version.

---

## 4. API contracts

### Public: `POST /api/growth/applications`

Purpose: submit a qualified private-access application.

Request:

```json
{
  "email": "person@example.com",
  "countryCode": "PT",
  "primaryJob": "move",
  "workflowFrequency": "weekly",
  "assetBand": "25k_100k",
  "relationshipType": "individual",
  "walletsChains": ["base", "ethereum", "external_wallet"],
  "desiredOutcome": "Reduce the number of manual steps when I receive USDC.",
  "betaContactConsent": true,
  "marketingConsent": false,
  "privacyNoticeVersion": "2026-09-22",
  "applicationVersion": "private-access-v1",
  "attribution": {
    "anonymousSessionId": "uuid",
    "utmSource": "founder",
    "utmMedium": "social",
    "utmCampaign": "founding-100",
    "utmContent": "control-before-yield-01",
    "referrerHost": "example.com",
    "landingPath": "/",
    "partnerCode": null,
    "contentId": "control-before-yield-01"
  },
  "turnstileToken": "..."
}
```

Behavior:

- normalize and validate email; encrypt it and compute an HMAC lookup key;
- require `betaContactConsent: true`; optional marketing consent must default false;
- verify Turnstile with action `private_access_application`;
- rate-limit by rotating IP-derived abuse key and anonymous session;
- use a generic idempotent success response for both first and duplicate submissions;
- update only non-sensitive fields on a duplicate if the privacy/application version is current;
- write `application_submitted` and consent audit evidence in one D1 batch/transaction-equivalent sequence;
- never auto-qualify based on asset band or country alone.

Response: `202` with `{ received: true, applicationReference, traceId }`. The reference must be random and must not support a public status lookup.

### Public: `POST /api/growth/events`

Purpose: capture allowlisted public events.

- Max 20 events per request; max 10 KB body.
- Allow only public event names and a small property schema per event.
- Drop rather than retry abusive or malformed telemetry.
- Never let telemetry failure block the application or product flow.
- Apply a stricter rate limit than the authenticated analytics route.
- `application_qualified`, `invite_issued`, retention, and other operator/server facts cannot be emitted from this route.

### Operations: `GET /api/ops/growth/applications`

Query parameters:

- `status`, `country`, `primaryJob`, `campaign`, `cursor`, `limit` (maximum 100).

List response excludes decrypted email and full desired outcome. Return a redacted label such as `p•••@example.com`, application metadata, source summary, and review state.

### Operations: `GET /api/ops/growth/applications/:applicationId`

Returns the full application to an authorized operator. Decrypt email only for this endpoint. Write an audit event that the record was viewed.

### Operations: `PATCH /api/ops/growth/applications/:applicationId`

Request supports:

- status transition;
- fit band;
- assignee;
- decision reason code.

Allowed transitions must be explicit. For example, `received -> reviewing -> qualified -> waitlisted/invited`; any state may move to `withdrawn`, while reopening a declined application requires an audit reason.

### Operations: `POST /api/ops/growth/applications/:applicationId/invite`

In one controlled operation:

1. verify the application is qualified/waitlisted;
2. verify country is currently allowed;
3. generate the one-use invitation using the existing secure code pattern;
4. insert `beta_invites` and `growth_invite_links`;
5. set application status to `invited`;
6. write `invite_issued` and an audit event;
7. return the code once with `Cache-Control: no-store`.

Do not email automatically in P0. The operator copies the code through the approved communication process until GROW-009 is activated.

### Operations: `GET /api/ops/growth/funnel`

Parameters: `from`, `to`, `campaign`, `country`, `primaryJob`, `cohort`.

Returns counts and conversion intervals for:

- visitors/sessions where consented and available;
- applications started/submitted;
- qualified;
- invites issued/redeemed;
- onboarding/security/wallet milestones;
- first value;
- 30-day retention;
- support and transaction-quality guardrails.

All denominators must be returned explicitly. Never calculate conversion from mismatched cohorts.

### Authenticated: `POST /api/growth/link`

Purpose: link an invited application to the verified Privy subject after invite redemption.

- Require verified subject.
- Derive the application from `beta_access.invite_hash -> growth_invite_links`; do not accept an arbitrary application ID from the client.
- Set subject linkage in attribution/events where appropriate.
- Be idempotent.
- Write an audit event.

---

## 5. UI requirements

### GROW-001: `/apply` private-access application

Files likely involved:

- `apps/web/src/app/apply/page.tsx`
- `apps/web/src/components/private-access-application.tsx`
- `apps/web/src/app/globals.css` or a scoped stylesheet
- `apps/web/src/app/api/growth/applications/route.ts`

Experience:

1. Explain that access opens in small, approved-country cohorts.
2. State that applying does not create an account or request a deposit.
3. Use a short progressive form with the fields in the data model.
4. Make asset band optional and explain why it improves cohort selection.
5. Separate required beta-contact consent from optional marketing consent.
6. Include Turnstile.
7. On success, show what happens next and that submission does not guarantee access.
8. Never display a queue position.

Accessibility:

- labels, descriptions, error summary, field-level errors, focus movement, live success state;
- no color-only state;
- works at 320 px width;
- respects reduced motion.

### GROW-006: marketing landing page

Update `apps/web/src/app/page.tsx`:

- primary CTA: **Apply for private access** -> `/apply`;
- secondary CTA: **Explore the product** -> `/tour`;
- current capabilities and future/provider-gated capabilities must be visually distinct;
- retain links to security, fees/alignment, provider responsibilities, legal, and status;
- add proof points that map to the claims registry;
- remove or qualify any hero language not approved for the selected launch country;
- record CTA/content IDs without blocking navigation.

### Public product tour: `/tour`

- Static/illustrative, no authentication and no wallet connection.
- Reuse product visual language, not operational or real customer data.
- Five steps: see, protect, receive, move, get help.
- Every unavailable feature says “planned” or “requires provider activation.”
- End with the application CTA.

### GROW-004: operations queue

Add a growth section to the existing operations workspace rather than a separate unprotected admin application.

Required views:

- inbox by status;
- filters for country, job, source, campaign, and age;
- application detail drawer/page with attribution and audit timeline;
- assign, qualify, waitlist, decline, withdraw, and invite actions;
- no bulk invite action in P0;
- reason codes required for decline/reopen;
- decrypted email shown only on detail view;
- clear separation between marketing qualification and regulated/product eligibility.

### GROW-007: funnel dashboard

Add cards and cohort tables for:

- submitted applications;
- qualified rate;
- invitation acceptance;
- median time to review and invite;
- account secured/wallet ready;
- first-value completion;
- 30-day retention when mature;
- support cases and failed/stale actions per activated user;
- conversion by segment and source.

Small cell counts should be suppressed or grouped where a breakdown could identify a person. Never display customer balances or AUM as a growth leaderboard.

---

## 6. Event and identity implementation

### Identity stages

```text
anonymous session (sessionStorage UUID)
  -> application ID
  -> hashed beta invite link
  -> verified Privy subject
```

The server performs each linkage. A public client must never claim a subject or application identity.

### Existing product event integration

Retain `product_events` for authenticated behavior. Add or confirm server-side emission at meaningful milestones:

- `onboarding_started`
- `account_secured`
- `wallet_ready`
- `live_balance_viewed`
- `first_value_completed`

Do not treat a route view as activation. Define `first_value_completed` once per subject/cohort through a server-verifiable event appropriate to the launch workflow. Examples include a live connected balance plus reviewed action, or a confirmed small transaction. Store the selected definition and version in event properties.

### Thirty-day retention

Create `retained_30d` only through a scheduled/server job when:

- the activation event is at least 30 days old;
- the user has returned in the defined day 21–37 window; and
- a meaningful product event or currently used funded relationship is present.

The exact rule must be versioned. Route views alone are insufficient.

---

## 7. Claims registry

### GROW-008 deliverables

Add:

- `marketing/approved-claims.json`
- `marketing/prohibited-claims.json`
- `marketing/content-register.json`
- `scripts/check-marketing-claims.mjs`
- a package script such as `marketing:check`

Each approved claim contains:

```json
{
  "id": "customer-signs-every-transaction-v1",
  "copy": "You sign every transaction.",
  "evidence": ["README.md", "apps/web/src/lib/transactions/policy.ts"],
  "surfaces": ["landing", "tour", "creator"],
  "countries": ["PT"],
  "requiredDisclosure": null,
  "approvedBy": "pending",
  "approvedAt": null,
  "reviewAt": null,
  "status": "draft"
}
```

CI behavior:

- fail if a registered content asset uses a prohibited exact phrase;
- fail if a claim is expired, withdrawn, or absent from the registry;
- report, but do not pretend to solve, semantic variants requiring human review;
- ensure every published content item has an owner, country/audience, disclosure, claim IDs, and review status.

The claims check supplements legal review; it does not replace it.

---

## 8. Lifecycle communication

### GROW-009 architecture

Create a vendor-neutral interface, for example:

```ts
type LifecycleMessage = {
  recipientReference: string;
  purpose: "beta_operational" | "marketing";
  templateKey: string;
  templateVersion: string;
  variables: Record<string, string>;
  idempotencyKey: string;
};

interface LifecycleMessenger {
  send(message: LifecycleMessage): Promise<{
    providerReference: string;
    status: "accepted" | "rejected";
  }>;
}
```

Requirements:

- no send without active consent for the matching purpose;
- operational beta messages cannot contain unrelated marketing;
- global and purpose-specific unsubscribe/withdrawal support;
- frequency cap for marketing;
- templates are versioned and use approved claim IDs;
- retries are idempotent;
- provider webhooks update delivery evidence without storing message bodies;
- suspension/restriction messages take precedence over campaigns;
- provide a no-op/local adapter for tests.

Initial templates:

- application received;
- invited to private beta;
- invitation expires soon;
- onboarding incomplete;
- first-value help;
- feedback request;
- monthly product/trust update for opted-in recipients.

Do not select or integrate a delivery vendor until data residency, DPA, suppression, webhook signing, domain authentication, and pricing are approved.

---

## 9. Referral implementation

### GROW-010 eligibility

Unlock referrals only when all are true:

- active beta access;
- account secured;
- first value completed;
- minimum account age/retention checkpoint configured server-side;
- no open critical security/account issue;
- geography and cohort capacity permit invitations;
- referral feature flag enabled.

Do not rely on a client-provided eligibility flag.

### Behavior

- one or two active referral invites per eligible customer;
- named or email-bound only if privacy/legal review approves; otherwise single-use code;
- expires after 14 days by default;
- no public queue-rank boost;
- revoke on abuse, restriction, or feature pause;
- referrals create normal beta invitations and still pass geography/access checks;
- referred users follow the same application/terms flow unless explicitly approved otherwise.

### Abuse controls

- no self-referral by matching subject, verified email HMAC, or other approved stable identifier;
- issuance and redemption velocity limits;
- no rewards until referred customer passes the retained milestone;
- manual review for repeated device/network patterns without building persistent fingerprinting;
- audit all revocations and reward decisions.

P1 should support access/recognition rewards only. Financial rewards remain P2 and require approved unit economics and terms.

---

## 10. Partner, creator, and content tracking

### GROW-011

- Operator creates a campaign slug and approved-country list.
- Generate URLs such as `/apply?partner=partner-slug&utm_campaign=...&content=...`.
- Reject or ignore unknown partner/content identifiers; do not create them from public requests.
- Report application, invitation, activation, retention, support, and incident quality by campaign.
- Partner-facing exports must be aggregate and privacy-safe; never expose applicant identities or balances.
- Creator records should include fixed fee/cost, published asset URL, disclosure type, approval evidence, and takedown/expiry date.

Attribution model for early cohorts:

- preserve first touch, last touch, and conversion touch;
- let applicants self-report “How did you hear about us?”;
- report both deterministic and self-reported source;
- do not invent multi-touch credit allocation before volume justifies it.

---

## 11. Experiments

### GROW-012

Allowed early experiments:

- hero/problem framing;
- application CTA copy;
- product-tour ordering;
- content hook and format;
- source/partner offer;
- application field explanation;
- onboarding guidance that does not alter required disclosures.

Prohibited experiments:

- hiding or weakening risks, fees, provider identity, or disclosures;
- different eligibility or transaction limits for marketing variants;
- urgency/scarcity claims that are not operationally true;
- default marketing consent;
- security, authentication, signing, recovery, or support degradation;
- personalized APY/return claims.

Use stable server-side assignment. The dashboard must show sample size, dates, primary metric, guardrails, and confidence/uncertainty without declaring a winner from tiny cohorts.

---

## 12. Wallet/treasury checkup — separate P2 project

GROW-015 should not block initial marketing. It needs its own threat model and product/legal review.

### Safe initial scope

- accept a public EVM address or a locally connected wallet;
- read supported-chain public state only;
- display chain/asset fragmentation, stablecoin issuer concentration, supported protocol exposure, liquidity labels, and known token approvals;
- explain observation timestamp, RPC/source, unsupported assets, and limits;
- run without authentication where practical;
- do not persist the address by default;
- permit a user-generated export locally in the browser;
- CTA to apply for private access, with no automatic association between the address and application.

### Explicit non-goals

- no suitability or credit score;
- no “safe/unsafe” rating;
- no tax calculation;
- no source-of-funds inference;
- no address enrichment from marketing data;
- no trade, bridge, borrow, or yield recommendation;
- no automated transaction from the report.

### Performance and privacy

- RPC fan-out is bounded and cached only by public address/data block where appropriate;
- failures and stale sources are visible;
- analytics record tool use, not the address;
- redact addresses from logs and error trackers;
- add rate limits and cost ceilings.

---

## 13. Tests and acceptance criteria

### Unit tests

- schemas reject unknown enum values, extra sensitive fields, oversized free text, invalid countries, and malformed attribution;
- email normalization, encryption/decryption, and HMAC deduplication;
- duplicate application returns generic success and does not duplicate consent/events;
- status transition matrix;
- campaign/content identifier validation;
- event/property allowlists;
- referral eligibility and caps;
- experiment assignment stability;
- retention rule and versioning;
- claim expiry/prohibition checks.

### API/security tests

- Turnstile action and production-hostname enforcement for application submission;
- rate limiting by abuse key/session;
- no email enumeration from timing/body/status differences within reasonable limits;
- operator endpoints deny anonymous, non-admin, and missing Cloudflare Access where required;
- application detail access writes audit evidence;
- invite code returned only once and never stored plaintext;
- application-to-invite flow cannot bypass allowed-country checks;
- public event endpoint cannot emit server facts;
- no PII or tokens in structured logs;
- injection and output-encoding tests for free text;
- consent withdrawal prevents subsequent marketing sends.

### End-to-end tests

1. Landing CTA -> application -> Turnstile -> generic success.
2. Duplicate application -> same safe success with one durable application.
3. Operator reviews -> qualifies -> issues invitation -> code redeem -> authenticated subject link.
4. Unsupported country application can be retained/waitlisted but cannot receive product invitation.
5. Funnel shows correct denominators and source/campaign.
6. Optional marketing consent unchecked still permits operational beta contact.
7. Referral remains locked before first value and unlocks after server evidence.
8. Revoked/expired referral cannot be redeemed.
9. Product tour clearly labels unavailable capabilities.
10. Mobile, keyboard, reduced-motion, and automated accessibility coverage.

### Recovery and migration tests

- migration applies cleanly to an empty and current schema;
- existing beta invites/access continue to work;
- growth records can be exported/deleted according to the retention schedule without touching financial projections;
- deleting growth analytics does not alter product access or money movement;
- backup/restore includes consent, application decisions, invite linkage, and audit evidence.

### P0 definition of done

- CI: typecheck, lint, unit, E2E, build, recovery, and `marketing:check` pass;
- public application is bot-protected and privacy-reviewed;
- operations access is fail-closed and audited;
- one application can be traced through invitation, redemption, activation, and source without exposing PII in analytics;
- landing and tour use approved, versioned claims;
- no launch-readiness or financial-authority invariant regresses;
- documentation covers environment variables, data retention, operations runbook, and rollback.

---

## 14. Environment and configuration

Add only after exact implementation names are chosen:

- `GROWTH_APPLICATION_MODE=closed|open|paused`
- `GROWTH_ALLOWED_COUNTRIES=PT,...`
- `GROWTH_EMAIL_ENCRYPTION_KEY` as a Workers secret
- `GROWTH_EMAIL_LOOKUP_KEY` as a distinct Workers secret
- `GROWTH_PRIVACY_NOTICE_VERSION`
- `GROWTH_APPLICATION_VERSION`
- `GROWTH_REFERRALS_ENABLED=false`
- `GROWTH_REFERRAL_LIMIT=1`
- `GROWTH_REFERRAL_EXPIRY_DAYS=14`
- delivery-provider secrets only when GROW-009 is approved

Rules:

- `paused` keeps the page informative but rejects new durable submissions with a calm, generic response;
- an empty allowed-country list means applications may be collected only if counsel approves global interest collection, but no invitations may be issued;
- production must fail closed when encryption/HMAC secrets are missing;
- dev/test use explicit non-production keys and isolated Miniflare data.

---

## 15. Suggested file map

The implementation agent should follow existing conventions and may consolidate where sensible.

```text
apps/web/src/app/apply/page.tsx
apps/web/src/app/tour/page.tsx
apps/web/src/app/api/growth/applications/route.ts
apps/web/src/app/api/growth/events/route.ts
apps/web/src/app/api/growth/link/route.ts
apps/web/src/app/api/ops/growth/applications/route.ts
apps/web/src/app/api/ops/growth/applications/[applicationId]/route.ts
apps/web/src/app/api/ops/growth/applications/[applicationId]/invite/route.ts
apps/web/src/app/api/ops/growth/funnel/route.ts
apps/web/src/components/private-access-application.tsx
apps/web/src/components/public-product-tour.tsx
apps/web/src/components/growth-operations.tsx
apps/web/src/components/growth-funnel.tsx
apps/web/src/lib/growth/applications.ts
apps/web/src/lib/growth/attribution.ts
apps/web/src/lib/growth/crypto.ts
apps/web/src/lib/growth/events.ts
apps/web/src/lib/growth/referrals.ts
apps/web/src/lib/growth/retention.ts
apps/web/src/lib/growth/claims.ts
infra/d1/migrations/0008_growth_distribution.sql
marketing/approved-claims.json
marketing/prohibited-claims.json
marketing/content-register.json
scripts/check-marketing-claims.mjs
apps/web/tests/unit/growth-*.test.ts
apps/web/tests/e2e/growth.spec.ts
```

---

## 16. Recommended ticket slices

To keep reviews safe and understandable, implement in this order:

1. **Migration and crypto helpers:** schema, encryption/HMAC helpers, tests, no UI.
2. **Application API:** validation, Turnstile, rate limiting, idempotency, audit, tests.
3. **Application UI:** `/apply`, consent, attribution collection, accessibility, E2E.
4. **Operations list/detail:** authorization, redaction, state transitions, audit.
5. **Invite bridge:** qualified application -> existing beta invite -> subject link.
6. **Public events:** allowlist, non-blocking client capture, privacy tests.
7. **Funnel API/dashboard:** explicit cohorts/denominators and guardrails.
8. **Landing/tour:** approved copy registry, CTA replacement, capability labels.
9. **Claims CI:** registry, prohibited checks, content register, docs.
10. **Lifecycle adapter:** only after provider/privacy approval.
11. **Referral loop:** only after activation and retention definition is live.
12. **Campaigns/experiments:** after the base funnel is reliable.

Each ticket should include migration impact, threat considerations, tests, rollback, documentation, and screenshots for desktop/mobile review.

---

## 17. Features not to build yet

- Public referral leaderboard or queue ranking.
- Cash, token, yield, deposit, or trading-volume referral rewards.
- Automated “AI growth agent” that publishes without human approval.
- Custom email infrastructure, CRM, social scheduler, or video generator.
- Cross-site tracking, browser fingerprinting, purchased lead enrichment, or wallet-to-identity enrichment.
- Auto-qualification from asset balance, geography, or wallet history.
- Paid-ad landing variants before claims and country approval.
- AUM or connected-wallet value as the primary growth KPI.
- Public wallet scoring, personalized investment advice, or “safe wallet” labels.
- Bulk invitation issuance before Cohort 1 operations are proven.

These exclusions are part of the implementation scope. They prevent the marketing system from creating compliance, security, privacy, and unit-economics debt before product-market fit.
