---
title: Aura build status
description: Current product implementation and external release dependencies.
---

Last reviewed: 24 September 2026. The public tour is deployed to `aura-dev.aurel-events.workers.dev`; this page describes the source branch, which may have newer changes. The dated Aura design and implementation plan are in `docs/superpowers/` at the repository root.

## Implemented in this branch

- Aura landing page, 12 customer sections, desktop/mobile navigation, and public browsing with labeled fictional data.
- Privy sign-in, invitation and country checks, linked wallets, passkey and recovery surfaces, wallet export, and transaction policy controls.
- Direct Base wallet reads and governed crypto-send preparation, simulation, customer signing, intent evidence, and reconciliation.
- LI.FI asset search and route discovery through the server-held reviewed swap flow. Unsafe direct browser execution was removed.
- Aave Base market, debt, position, and reward reads. Customer Aave writes remain paused.
- Aura tag registration with a unique, non-transferable tag, verified linked receiving wallet, public opt-in, and public crypto payment page. A separate bank-detail opt-in exposes complete activated Bridge instructions only for the linked provider customer; without a connected Bridge program, the method is unavailable. Card payment remains unavailable.
- Issuer-backed card projection read boundary, support cases, read-only assistant, coverage-aware transactions and insights, and security/privacy settings.
- D1 migrations through `0037_aura_tag_bank_consent.sql` on the isolated development database; no production migration or deployment has been performed.

The customer waitlist, markets lists, price alerts, goals, scheduled transfers, paycheck planning, external-wallet portfolio tracking, lifestyle concierge, and membership tiers have been removed from the UI. Historical database records, audit evidence, retained instructions, and security controls remain. Legacy routes redirect or close intake. Review historical API access and retention before deleting any stored records.

## External or incomplete

| Area | Required before customer execution |
| --- | --- |
| Bridge bank deposits and payouts | Program approval and credentials; activated USD virtual-account instructions are parsed and surfaced when connected, while outgoing beneficiaries, execution, returns, and reconciliation remain to integrate |
| Bridge/Rain cards | Issuer program, card creation and control mutations, wallet provisioning, transaction feed, dispute adapter |
| Card payments on Aura tag pages | Acquiring/payment-link provider, recipient onboarding, payment state, refunds, and disputes |
| Sky and Morpho vaults | Selected contracts, risk review, exact-call preparation, simulation, settlement, and support |
| Aave writes | Governed execution plan, action-bound authorization, and verified effects |
| Tokenized stocks and metals | Issuer, venue, eligibility, country controls, order execution, and disclosures |
| Cashback and benefits | Funded provider program, eligibility, fulfilment, and transaction evidence |
| Passcode and remote sessions | Supported identity-provider controls and recovery process |
| Notifications | Connected delivery provider and preference enforcement |
| Production release | Secrets, reviewed migration, security and marketing approvals, provider contracts, domain controls, staffed operations, and final smoke checks |

A provider, chain, or protocol is authoritative for balances and settlement. D1 projections never confer financial authority. Marketing copy remains pending the registered human claim review; user approval of the implementation plan is not evidence of legal or marketing signoff.
