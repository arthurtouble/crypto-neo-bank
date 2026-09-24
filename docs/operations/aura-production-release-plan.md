# Aura production release plan

Last reviewed: 24 September 2026. Branch: `codex/aura-product-simplification`. This is an evidence register, not release approval. `production-readiness-2026-09-23.md` is the historical Aurel development ledger.

## Release rule

Release public example-data browsing after its domain, privacy, accessibility, marketing, support, and monitoring gates pass. Activate each authenticated financial rail separately after its provider, security, funded-test, reconciliation, and operating gates pass. A feature flag or API key alone is not proof that a rail is ready. Provider and on-chain records remain authoritative; D1 is a projection and audit store. Missing authoritative values stay unavailable.

The checked-in Worker configuration still points to a workers.dev preview origin, a development Privy app ID, preview access mode, and preview Bridge mode. This branch has not been deployed; migrations `0036_aura_tags.sql` and `0037_aura_tag_bank_consent.sql` have not been applied remotely. The existing development D1 also lists `0035_growth_waitlist_upgrade.sql` as pending. Keep `direct_transfers`, `swaps`, `cross_chain`, and `defi_actions` disabled until each has an approved release record.

## Inputs needed from the owner

| Input | Why | Status |
| --- | --- | --- |
| Access to the Cloudflare account owning `aurel-events.workers.dev` | A stable Aura-named `workers.dev` development Worker can be created there. The local Wrangler CLI was authenticated through the embedded browser and resolves to the Crypto Neo Bank account. | Available for development preparation |
| A domain controlled in a Cloudflare zone, or approval to buy/register one | Final production HTTPS origin, Privy allowed origin, passkey RP ID, Turnstile hostname, DNS and edge policy. A custom subdomain requires a parent domain; `workers.dev` is sufficient for development. | No production domain yet |
| Registered and customer contracting entity | Terms, provider contracts, disputes, customer support identity. Keep the existing legal name until verified. | Unverified |
| Initial countries, assets, networks and services each provider authorizes | Provider-specific eligibility and release scope. DeFi or delegated KYC alone does not prove worldwide availability. | No approved program scope supplied |
| Privy, Bridge, Rain, acquiring/payment-link, securities/metals, rewards, delivery and support program contacts | Production access and responsibility boundaries | No production programs yet |
| Named primary/backup incident owners, support coverage and provider escalation contacts | Customer and incident response | Unassigned |
| Independent security assessor and claims/terms reviewer | Review evidence | Unassigned |
| Controlled-test budget and operator | Funded success, failure, return and refund rehearsals | Unassigned |

Put credentials in provider dashboards or a secret manager, never in this file or chat. Production provider approval often has steps beyond issuing an API key.

## Product and provider gates

| Area | Current source state | Evidence before live use |
| --- | --- | --- |
| Public browse and landing | Aura pages with labeled fictional data; undeployed branch | Final-domain claims/footnotes, privacy/support links, accessibility and responsive check, analytics consent review |
| Identity and recovery | Privy sign-in, invitation/country controls, wallet/passkey/recovery surfaces | Production Privy app/origins, sign-in and recovery rehearsal, session revocation and passcode capability confirmation, export safeguards |
| Overview, activity and insights | Direct chain/provider reads with coverage labels; D1 intent evidence | Reliable RPC/indexer capacity, completeness and reconciliation sampling, valuation/price evidence, delayed/failed activity handling, statement source |
| Crypto deposit and send | Address/tag UI and governed Base action foundations | Asset/network matrix, exact-call review, simulation, signing, fees/limits, funded rehearsals, settlement and support recovery |
| Bridge bank deposit/payout | Preview boundary. An activated, customer-matched USD virtual account with complete instructions can be shown after Bridge connection; no outgoing execution exists | Approved Bridge program and scope, verified beneficiaries, execution/return states, signed webhook replay tests, reconciliation and support responsibility |
| Aura tag public page | Crypto method; separate opt-in exposes activated Bridge bank instructions after connection; card unavailable | Recipient verification and consent, abuse controls, separate acquiring/payment-link program for card, confirmation/refund/dispute states |
| Swap | LI.FI search/quotes and narrow governed review; financial flags off | Per-route calldata/allowance review, route matrix, expiry/slippage disclosure, source/destination confirmation, 100 test movements across published pairs, delayed-destination recovery |
| Earn and borrow | Aave Base reads; writes paused; Sky/Morpho not connected | Selected markets/contracts and risk review, exact-call deposit/withdraw/borrow/repay, debt/health/liquidation disclosure, funded settlement and unwind. Release each protocol independently |
| Invest | Discovery/eligibility boundary | Issuer and venue programs, country/product eligibility, price/order lifecycle, corporate actions/redemption, custody/statements and risk disclosure |
| Cards | Issuer projection/read boundary and dispute entry | Bridge/Rain program, create/freeze/limits/countries/PIN/provision/terminate APIs, transaction feed, PCI-sensitive data boundary, chargeback lifecycle and reconciliation |
| Rewards | Informational boundary | Funded cashback/benefit program, eligibility, earning/reversal ledger, fulfilment and customer terms |
| Notifications and support | Preferences, support intake, read-only assistant | Delivery provider, preference enforcement, staffed support, response targets, incident channel, assistant escalation/privacy review |

Removed customer-facing features stay out of navigation. Historical records, valid obligations, and security/audit evidence remain. Review legacy API writes and retention before disabling or deleting data.

## Platform and operations gates

| Gate | Evidence | Owner |
| --- | --- | --- |
| Configuration | Dedicated production hostname/account; Privy app/origin; invite or approved access mode; Turnstile widget/action/hostname; operator Access; reviewed feature flags | Engineering/operations |
| Secrets and webhooks | Production secrets installed through protected channel; least privilege and rotation owner; sandbox/production separation; signed webhook and replay tests | Engineering/provider owner |
| D1 and recovery | Snapshot/export and integrity; migration `0036` on a staging copy; deploy order and forward-fix plan; restore drill and evidence retention | Engineering/operations |
| Edge and observability | Domain, WAF/rate limits, API schema validation, Access, logs/retention/export, alerts to an on-call receiver, version affinity before split traffic | Operations |
| Security | Independent auth/passkey, wallet export, exact-call signing, webhook, abuse/PII, provider-boundary and frontend review; no unresolved high/critical finding | Security assessor |
| Legal/product | Confirm entity and provider-specific countries/products; effective dated Terms/privacy/risk/routing disclosures, complaints/retention, responsibility matrix and sanctions/fraud handoff | Product/provider owner/reviewer |
| Operations | Primary/backup, support hours, provider severity contacts, customer incident channel, dispute/return playbooks, kill-switch and rollback exercise | Operations/support |
| Acceptance | Full CI, final-domain desktop/mobile, five uncoached users, funded movement per released route, failure recovery, post-deploy smoke and sampled reconciliation | Product/engineering |

## Execution order

1. Fix initial scope and decide which rails stay unavailable at first public release. Record the owner inputs above.
2. Obtain provider access and review the documented API contract for each chosen rail. Configure a production-shaped staging environment without real customer data.
3. Finish selected adapters and test exact-call execution, webhooks, reconciliation, refusals, returns, disputes, recovery and accessibility. Commission independent security review.
4. Prove backup/restore, migration impact, edge policy and monitoring. Upload a candidate version with financial flags off.
5. Run final-domain desktop/mobile checks, uncoached customer journeys and controlled funded acceptance. Record results and approve each rail separately.
6. Deploy gradually with on-call coverage and a named rollback/forward-fix owner; monitor authoritative provider state, projections, alerts and support.

For every rail attach: program approval; country/asset/network scope; production credential owner; API/webhook version; disclosures; security review; exact-call and fail-closed tests; funded success/failure/return evidence; reconciliation sample; support and escalation; kill-switch test; owner and approval date. An unchecked item means the rail remains unavailable.
