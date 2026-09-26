---
title: Aura build status
description: Current product implementation and external release dependencies.
---

Last reviewed: 25 September 2026. The branch is deployed to `aura-dev.aurel-events.workers.dev`; this page describes the source branch, which may have newer changes. Dated plans and release logs are in `docs/archive/`. The current refactor plan is in the [codebase audit](codebase-audit-2026-09-25.md).

## Implemented in this branch

- Aura landing page, 11 customer sections, desktop/mobile navigation, and public browsing with labeled fictional data.
- Privy sign-in open to everyone, with acceptance of the current terms and privacy notice recorded per version on first sign-in.
- A Privy smart wallet on Base for each customer, holding funds and signing each action as one batched operation. Gas sponsorship needs the paymaster configured in the Privy dashboard.
- One pipeline for every money movement ([money actions](../architecture/money-actions.md)): `POST /api/actions` prepares exact calls server-side, the smart wallet signs them, and the server verifies operation identity, finality, expected events, and cross-chain delivery from chain evidence. Records live in `actions`, `action_events`, and `route_quotes`.
- Server-side checks on every action: feature switches, account lock, the optional daily limit, saved-recipients-only mode, and new-recipient cooling. Customer changes apply immediately and are audited.
- Sends of Base assets from the smart wallet.
- A chain-read Overview (`GET /api/overview`) of cash, crypto, and earn deposits valued in US dollars, with a total portfolio value and per-holding source and observation time; an invest catalog (cbBTC and ETH on Base); transaction detail with history; monthly CSV statements; and screen data hooks with labelled guest examples ([screen data](../architecture/frontend-data.md)).
- Bridge bank accounts built to Bridge's documented API and switched off: onboarding, a USD account paying into the smart wallet, saved bank accounts, and payouts funded by a normal transfer action. Needs Bridge approval and keys.
- Swaps and cross-chain moves through one LI.FI route module: any catalog asset to any catalog asset, same or cross chain, with server-held 45-second quotes, the call target and approval spender pinned to the LI.FI Diamond, a price-impact cap of 3%, assets limited to the registry ([assets](../architecture/assets.md)), and customer-chosen slippage of 0.1, 0.5, or 1%.
- Aave supply and withdraw on Base, and Sky USDC savings on Ethereum, behind the `defi_actions` switch.
- Aura tag registration with a unique, non-transferable tag, verified linked receiving wallet, public opt-in, and public crypto payment page. Bank details appear only for an activated Bridge customer; card payment remains unavailable.
- Provider projections for cards, memberships and benefits, and wallet-provider rules, applied from signed provider events by the events Worker (see [provider projections](../architecture/provider-projections.md)).
- Notification choices, product-update consent, and self-service data export and deletion backed by a classified inventory of every customer-data table.
- Support cases, coverage-aware transactions and insights, and the operations console (issues, reconciliation, feature switches, analytics).
- One D1 baseline schema, `infra/d1/migrations/0001_baseline.sql`, squashed from the former 42 migrations on 25 September 2026. The isolated development database has been reset to it, and dev deploys reset it again whenever the baseline changes. No production migration or deployment has been performed.

Borrowing, the support assistant, the partner sandbox and demo provider, regulated market orders and eligibility, the portfolio history and tax-lot pipeline, and the previous transaction pipeline (its evaluate/prepare/status/reconcile routes, action passkey approval, simulation and fee budgets, the single-DEX swap path, and the single-bridge route policy) were removed on 25 September 2026 (see the codebase audit). Earlier, the customer waitlist, markets lists, price alerts, goals, scheduled transfers, paycheck planning, external-wallet portfolio tracking, lifestyle concierge, the private-beta invitation gate, and Aura-computed membership tiers have been removed. Their API routes are removed and return 404. Migrations `0040`–`0042` drop the retired goal, bill, subscription, income-plan, transfer-schedule, price-alert, swap-reminder, waitlist, referral, campaign, experiment, growth-event, communication, and retention-run tables, and disables unredeemed customer referral codes. Audit evidence, consent records, and beta invitations remain.

## External or incomplete

| Area | Required before customer execution |
| --- | --- |
| Bridge bank deposits and payouts | Program approval and credentials; activated USD virtual-account instructions are parsed and surfaced when connected, while outgoing beneficiaries, execution, returns, and reconciliation remain to integrate |
| Bridge/Rain cards | Issuer program, card creation and control mutations, wallet provisioning, transaction feed, dispute adapter |
| Card payments on Aura tag pages | Acquiring/payment-link provider, recipient onboarding, payment state, refunds, and disputes |
| Smart wallet and gas sponsorship | Privy dashboard: smart wallets on (Kernel v3), Base bundler and paymaster |
| Funded actions | No funded action has been signed yet. Each kind needs a funded rehearsal before its switch is turned on |
| Morpho vaults | Selected contracts, risk review, builder, expected effects, and support |
| Tokenized stocks and metals | Issuer eligibility and restrictions; no regulated assets are listed in the catalog registry yet |
| Cashback and benefits | Funded provider program, eligibility, fulfilment, and transaction evidence |
| Passcode and remote sessions | Supported identity-provider controls and recovery process |
| Notifications | Connected delivery provider and preference enforcement |
| Production release | Secrets, reviewed migration, security and marketing approvals, provider contracts, domain controls, staffed operations, and final smoke checks |

A provider, chain, or protocol is authoritative for balances and settlement. D1 projections never confer financial authority. Marketing copy remains pending the registered human claim review; user approval of the implementation plan is not evidence of legal or marketing signoff.
