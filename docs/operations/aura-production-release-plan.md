# Aura production release plan

Last reviewed: 24 September 2026. Branch: `codex/aura-product-simplification`. This is an evidence register, not release approval. `production-readiness-2026-09-23.md` is the historical Aurel development ledger.

## Release rule

Release public example-data browsing after its domain, privacy, accessibility, marketing, support, and monitoring gates pass. Activate each authenticated financial rail separately after its provider, security, funded-test, reconciliation, and operating gates pass. A feature flag or API key alone is not proof that a rail is ready. Provider and on-chain records remain authoritative; D1 is a projection and audit store. Missing authoritative values stay unavailable.

An isolated Aura development Worker is deployed at `aura-dev.aurel-events.workers.dev` with a fresh D1 migrated through `0038_support_assistant_flag.sql`. Its public example-data tour works; the development Privy secret is installed and the origin is allowed, but account sign-in and a funded transaction have not been tested. Dev now uses invite mode with one expiring, single-use owner invitation and ISO country codes for test access. The original `aurel-financial-os` Worker and D1 were not changed. Its D1 still needs Aura migrations applied before any future production release. `direct_transfers` and the narrow same-chain `swaps` path are enabled only in isolated dev D1; `cross_chain` and `defi_actions` remain disabled there. Production financial flags remain disabled.

On 24 September, workspace typechecks and a local D1 backup/restore drill passed through migration `0038`, preserving invitation, consent, passkey, authorization, and audit evidence. The marketing-claims check remains red because the Aura landing content register is `pending` human review; no approval was inferred from a passing build.

The existing `aurel-internal-kb.aurel-events.workers.dev` serves internal runbooks without an Access challenge (anonymous HTTP 200 observed on 24 September). Its production and preview workers.dev URLs are enabled, and this Cloudflare account has no Zero Trust organization yet. Restrict or disable both URLs before sharing internal operational material. The isolated Aura development docs Worker is public and contains only customer-facing documentation.

## Inputs needed from the owner

| Input | Why | Status |
| --- | --- | --- |
| Access to the Cloudflare account owning `aurel-events.workers.dev` | The local Wrangler CLI was authenticated through the embedded browser and an isolated Aura development Worker, database, and queue were created. | Complete for development |
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
| Public browse and landing | Aura development Worker deployed; 45 desktop/mobile Playwright checks passed, one skipped; guest examples remain browsable while Privy initializes; final claims review pending | Final-domain claims/footnotes, privacy/support links, accessibility and responsive check, analytics consent review |
| Identity and recovery | Privy sign-in, invitation/country controls, wallet/passkey/recovery surfaces | Production Privy app/origins, sign-in and recovery rehearsal, session revocation and passcode capability confirmation, export safeguards |
| Overview, activity and insights | Direct chain/provider reads with coverage labels; D1 intent evidence | Reliable RPC/indexer capacity, completeness and reconciliation sampling, valuation/price evidence, delayed/failed activity handling, statement source |
| Crypto deposit and send | Address/tag UI and governed Base action foundations | Asset/network matrix, exact-call review, simulation, signing, fees/limits, funded rehearsals, settlement and support recovery |
| Bridge bank deposit/payout | Preview boundary. An activated, customer-matched USD virtual account with complete instructions can be shown after Bridge connection; customer lookup now follows Bridge cursors beyond the first 100 records; no outgoing execution exists | Approved Bridge program and scope, verified beneficiaries, execution/return states, signed webhook replay tests, reconciliation and support responsibility |
| Aura tag public page | Crypto method; separate opt-in exposes activated Bridge bank instructions after connection; card unavailable | Recipient verification and consent, abuse controls, separate acquiring/payment-link program for card, confirmation/refund/dispute states |
| Swap | LI.FI search/quotes and narrow governed review. Invited dev accounts can prepare Base USDC/WETH direct Uniswap calls; LI.FI cross-chain execution remains off | Funded test of each supported route, allowance, expiry, failure, and destination confirmation |
| Earn and borrow | Aave Base reads, optional risk preview, exact supply/withdraw/borrow/repay calls for an active invite account, and chain receipt/Pool event status. Dev invite mode is configured. Sky/Morpho are not connected | Exercise approval, signing, settlement, revert, and repayment with a self-owned wallet before calling the flow live |
| Invest | Discovery/eligibility boundary | Issuer and venue programs, country/product eligibility, price/order lifecycle, corporate actions/redemption, custody/statements and risk disclosure |
| Cards | Issuer projection/read boundary and dispute entry | Approved issuing path, create/freeze/limits/countries/PIN/provision/terminate APIs, transaction feed, PCI-sensitive data boundary, chargeback lifecycle and reconciliation. Bridge [marks its older card-provisioning API deprecated](https://apidocs.bridge.xyz/api-reference/cards/provision-a-card-account) in favor of Stripe Issuing; Rain is a separate program. Do not wire either as a key-only toggle before program details are known |
| Rewards | Informational boundary | Funded cashback/benefit program, eligibility, earning/reversal ledger, fulfilment and customer terms |
| Notifications and support | Preferences, support intake, read-only assistant | Delivery provider, preference enforcement, staffed support, response targets, incident channel, assistant escalation/privacy review |

Removed customer-facing features stay out of navigation. Goals, income planning, bill reminders, transfer schedules, price alerts, recurring swap reminders, waitlist/referrals, campaigns, growth experiments, and local-only communications reject new creation. The retired growth milestone scheduler is removed from the event Worker source; the previously deployed event Worker has not been changed by this branch. Historical records and cancellation/archive paths remain where relevant. Valid obligations and security/audit evidence remain.

## Platform and operations gates

| Gate | Evidence | Owner |
| --- | --- | --- |
| Configuration | Dedicated production hostname/account; Privy app/origin; invite or approved access mode; Turnstile widget/action/hostname; operator Access; reviewed feature flags | Engineering/operations |
| Secrets and webhooks | Production secrets installed through protected channel; least privilege and rotation owner; sandbox/production separation; signed webhook and replay tests | Engineering/provider owner |
| D1 and recovery | Snapshot/export and integrity; Aura migrations `0036`–`0038` on a staging copy; deploy order and forward-fix plan; restore drill and evidence retention | Engineering/operations |
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
