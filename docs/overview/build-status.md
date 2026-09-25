---
title: Aura build status
description: Current product implementation and external release dependencies.
---

Last reviewed: 25 September 2026. The branch is deployed to `aura-dev.aurel-events.workers.dev`; this page describes the source branch, which may have newer changes. Dated design and implementation plans are in `docs/superpowers/`.

## Implemented in this branch

- Aura landing page, 12 customer sections, desktop/mobile navigation, and public browsing with labeled fictional data.
- Privy sign-in open to everyone, with acceptance of the current terms and privacy notice recorded per version on first sign-in.
- Server-side controls on every money-moving path: feature switches, account locks, per-account daily limits, saved-address cooling, review thresholds, and transaction policy, rechecked inside the atomic D1 writes.
- Direct Base wallet reads and governed crypto-send preparation, simulation, customer signing, intent evidence, and reconciliation.
- Swaps: direct Uniswap V3 calls for Base USDC/WETH, and Base USDC to Arbitrum or Ethereum USDC through LI.FI and Across, each through the server-held reviewed flow.
- Aave Base supply, withdraw, borrow, and repay, and Sky USDC deposits and withdrawals on Ethereum, behind the `defi_actions` switch.
- Aura tag registration with a unique, non-transferable tag, verified linked receiving wallet, public opt-in, and public crypto payment page. Bank details appear only for an activated Bridge customer; card payment remains unavailable.
- Provider projections for cards, memberships and benefits, and wallet-provider rules, applied from signed provider events by the events Worker (see [provider projections](../architecture/provider-projections.md)).
- Notification choices, product-update consent, and self-service data export and deletion backed by a classified inventory of every customer-data table.
- Support cases, read-only assistant, coverage-aware transactions and insights, and the operations console (issues, reconciliation, feature switches, analytics).
- D1 migrations through `0042_privacy_and_flag_vocabulary.sql` on the isolated development database; no production migration or deployment has been performed.

The customer waitlist, markets lists, price alerts, goals, scheduled transfers, paycheck planning, external-wallet portfolio tracking, lifestyle concierge, the private-beta invitation gate, and Aura-computed membership tiers have been removed. Their API routes are removed and return 404. Migrations `0040`–`0042` drop the retired goal, bill, subscription, income-plan, transfer-schedule, price-alert, swap-reminder, waitlist, referral, campaign, experiment, growth-event, communication, and retention-run tables, and disables unredeemed customer referral codes. Audit evidence, consent records, and beta invitations remain.

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
