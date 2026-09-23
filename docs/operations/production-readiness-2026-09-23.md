# Production readiness — 23 September 2026

This is the release ledger for the product-parity branch. A green build is not permission to move money. The appropriate near-term target is an invite-only engineering beta with designated testers and small funds, after its access policy is verified. Aurel is **not** approved for a public financial-service launch. Keep every action whose authority or evidence is missing disabled.

The [approved product design](../../docs/superpowers/specs/2026-09-22-aurel-product-parity-design.md) defines the financial-authority and safety rules. The [roadmap](../../PRODUCT_PARITY_ROADMAP.md) describes customer-facing scope. This ledger distinguishes work that can be completed in code from evidence that requires an operator, partner, independent reviewer, or counsel.

## Release decision

| Area | Current evidence | Required before activation |
| --- | --- | --- |
| Direct wallet Send | Exact Base ETH/ERC-20 transfer preparation and receipt/effect checks exist. Delayed-hash reconciliation now retries fairly and was independently reviewed. A required transaction-specific step-up still fails closed. | Complete server-verifiable step-up; test limits, cooling, expiry, replacement, and recovery with authorized testers. |
| Swap and cross-network movement | Searchable screened LI.FI catalog and validated quote preview. Signing is disabled. | Immutable server-held route, exact approval and swap call validation, fresh policy/step-up/simulation, source effect and destination delivery evidence, rollback switch, and independent security review. |
| Portfolio and tax support | Base source replay, seven completed UTC days, ETH/USDC prices, gap-aware chart, versioned FIFO support. | Complete source coverage and economic classification, independently priced wider ranges, current Aave leg valuation, source-shaped end-to-end tests, documented unsupported assets/periods. Never invent missing history or cost basis. |
| Earn, Borrow, reward claims | Current Aave reads and previews; action signing disabled. | Governed call semantics, exact approval bounds, simulation, step-up, independently verified effects, protocol risk review. Managed strategies also need a contracted provider or governed revocable mandate. |
| Price alerts and recurring Swap | Not implemented; wallet-transfer reminders exist. | Idempotent alert triggers and customer-controlled notifications; each recurring Swap occurrence requires a fresh quote and explicit approval. No timer may sign. |
| Bank, card, benefits, concierge | Provider-ready customer surfaces, no live operator connection. | Executed contracts, production credentials, country/capability matrix, provider settlement and reconciliation, support and escalation ownership. Keep `setup_required` until the provider reports availability. |
| Tokenized securities | Read-only issuer catalog and eligibility/order adapter boundary. | Issuer/venue/distributor onboarding, instrument rights and disclosures, counsel-approved countries/customer classes, fresh provider eligibility, settlement evidence. A DEX quote is not authorization. |
| Access policy | Checked-in Worker uses `BETA_ACCESS_MODE=preview`, no production country allowlist or named operator subjects. | Set invitation policy and approved countries, assign named operators, verify existing customer migration and denial cases, test Access and emergency lock. |
| Customer security settings | The policy API currently accepts relaxation of the step-up threshold, daily limit, account lock, allowlist, and cooling settings with an ordinary session. | Enforce a non-customer-relaxable product floor and require transaction-bound step-up before loosening any customer protection. Tightening controls may remain immediate. |
| Security and operations | Logs/traces and local recovery drill exist; independent review and human response coverage are open. | Independent assessment with no open Critical/High findings, primary/backup incident and support coverage, alert receiver, retention/export, edge controls, backup/restore exercise, kill-switch and rollback drill. |
| Credentials | A 23 September scan of non-hidden repository source found no literal Privy app secret or webhook/Turnstile secret. A read-only Worker secret-name check found all five names required by `wrangler.jsonc`; it did not verify their values. A Privy app secret was previously shared in a chat. | Rotate that secret in Privy and Cloudflare before a broader launch; verify the old value is revoked and the new binding works without printing either value. Review other shared credentials and access logs. |
| Dependencies | `pnpm audit --audit-level high` found no high/critical advisory, but the moderate-level audit found two transitive advisories: `uuid` below 11.1.1 and `decode-uri-component` through 0.4.2 in the Privy/wallet connector tree. | Confirm reachable usage and update/override compatible transitive versions; rerun audit, builds, and wallet regression tests before release. |
| Legal | Public legal pages are marked pre-launch drafts. | Counsel signs entity, countries, customer terms/disclosures, custody/DeFi/securities/provider responsibilities and complaints process before the affected service is offered. |

## Build order

1. Continue closing the transaction-evidence boundary. Recovery of broadcast hashes that were not indexed at first observation, including fair retry after RPC errors, has been independently reviewed. Do not activate another wallet-write flow until its entire path is independently reviewed.
2. Bind a fresh server-verifiable step-up to the exact reviewed action; then add server-held, immutable LI.FI route plans and governed approval/swap calls. Requote after any prerequisite approval or expiry. Verify both source and destination settlement before completion.
3. Improve portfolio source classification and coverage. Expand price coverage and historical ranges only when complete source intervals and independent prices can be published together. Reconcile Aave supply, debt, and rewards without double counting receipts.
4. Add alerts and approval-required recurring Swap as instructions and reminders, not autonomous trading. Keep conditional orders and managed Earn behind a reviewed mandate/provider.
5. Run full unit, typecheck, lint, app/docs builds, recovery drill, desktop/mobile keyboard and reduced-motion checks, read-only mainnet checks, and a candidate smoke test. Run authorized human journeys; automation never signs a production transaction.
6. Verify remote migration status and backup, apply backward-compatible migrations, upload a candidate, check its bindings/secrets and protected routes, then use a deliberate rollout with monitored rollback. A D1 migration is not reversed by reverting Worker code.

## Operator acceptance record

Do not change this section to “done” based on code or simulated provider fixtures. Attach the actual evidence and approver for each item.

| Gate | Evidence to attach | Owner |
| --- | --- | --- |
| Security review | Report, remediation record, no open Critical/High findings | Independent reviewer + operator |
| Human acceptance | Five uncoached non-crypto journeys; at least 100 designated money-movement trials with ≥98% completion; delayed-route/recovery exercise | Product operator |
| Jurisdiction and legal | Signed country matrix, terms, risk disclosures, privacy and provider-responsibility allocation | Counsel |
| Financial providers | Contracts, production keys, webhook/settlement reconciliation, escalation contacts, capability tests | Provider owner |
| Incident response | Primary and backup responders, support hours, out-of-band channel, on-call alert delivery, rollback drill | Operations owner |
| Edge and release | Production domain, Access/WAF/rate-limit/API protection, log retention, version-affinity decision, migration backup, candidate and post-release smoke | Infrastructure owner |

## Current automated baseline

On 23 September 2026 the local branch passed its initial 422 unit tests in 71 files, TypeScript typecheck, ESLint, the web and documentation builds, the isolated D1 recovery drill through migration `0020`, and desktop/mobile Playwright (38 passed, 2 skipped). Read-only mainnet checks confirmed five configured chain IDs and USDC contract-code presence, plus one Base-to-Arbitrum LI.FI quote; no transaction was constructed, signed, or broadcast. The documentation build emitted existing Astro/Vite content warnings but no Astro check errors. The web build emitted missing-local-secret and Wrangler-log-permission warnings but exited successfully; local Playwright emitted development-only Vinext/React warnings. Read-only smoke against the **currently deployed** Worker passed its baseline health, security-header, protected-route, docs redirect, and unsigned-webhook checks. That run did **not** set `AUREL_EXPECT_PARITY=1`; it did not test the unpublished parity branch or any authenticated financial flow. A read-only remote D1 check listed migrations `0014`–`0020` as pending. No production deployment or migration was performed.

The subsequently reviewed delayed-hash reconciliation changes passed 434 unit tests in 71 files, TypeScript typecheck, and ESLint.

## Non-negotiable release rules

- D1 projections are not customer balances, settlement records, provider entitlements, or a substitute for chain/provider reads.
- An indexed hash, successful receipt, quote, or token-list entry alone cannot complete or authorize a financial action.
- A previously broadcast transaction must remain observable even if review expires or a kill switch closes; new preparation and signing must stop.
- Failure or uncertainty is shown as pending, unavailable, or review required, never as successful.
- No real-money QA by automation. Do not turn on fiat, cards, securities, managed Earn, rewards fulfillment, or shared accounts from fixtures or UI readiness alone.
