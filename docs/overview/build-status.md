---
title: Aura build status
description: What is built, and what still depends on providers.
---

Last reviewed: 30 September 2026. Describes `main`, deployed to `aura-dev.aurel-events.workers.dev`. Nothing is deployed to production. How each feature was built is in [feature readiness](feature-readiness.md); dated plans and release logs are in `docs/archive/`.

## Built

- **Public app and sign-in.** Landing page, the customer sections, desktop and mobile navigation, and guest browsing with labeled fictional data. Privy sign-in by email, Google, Telegram, or wallet, open to everyone, from one "Create account or sign in" button. Every account has an email (a Telegram or wallet sign-in adds one, verified by Privy), and acceptance of the current terms and privacy notice is recorded per version; the server refuses customer routes until both are in place ([launch controls](../operations/launch-controls.md)).
- **Account.** A Privy embedded wallet per customer, upgraded in place with EIP-7702, with the same address on every EVM network; Privy pays gas ([accounts and custody](../architecture/accounts-and-custody.md)).
- **Server checks on every action**: feature switches, the passkey requirement, asset pauses, account lock, the optional daily limit, saved-recipients-only mode, and new-recipient cooling. Loosening a control needs a server-verified passkey confirmation. Details and switch names: [launch controls](../operations/launch-controls.md).
- **Money actions**: prepared, signed, relayed through Privy, and verified from chain evidence ([money actions](../architecture/money-actions.md)).
- **Add money** (was Deposit). The account address and QR code on Base; adding from a connected wallet on Base, Ethereum, Arbitrum, Optimism, or Polygon, moved through LI.FI to the same asset on Base; card funding through Privy's `useFundWallet`. Bank deposits show as coming soon.
- **Send.** Every registered `send` asset ([assets](../architecture/assets.md)) to an address, saved recipient, Aura tag, or the customer's own linked wallets, on Base or, for ETH and USDC, another network through LI.FI with fees taken from the amount. The server refuses the account's own address and registered token contracts. Bank payouts show as coming soon.
- **Swaps and cross-chain moves** through one LI.FI route module: from any held asset to any registered asset, same or cross chain, with server-held 45-second quotes, the LI.FI Diamond pinned as call target and spender, a 3% price-impact cap, Chainlink reference prices with a 2% gap warning for stocks and gold, and customer slippage of 0.1, 0.5, or 1%.
- **Earn on Base**, behind `defi_actions`: Aave V3 USDC and WETH, and two Morpho USDC vaults, Steakhouse Prime USDC (Vault V2) and Gauntlet USDC Prime (V1). The server re-checks each vault's asset and V2 access gates on chain before building. Sky was cut; Syrup is deferred.
- **Markets** (switches `perps` and `predictions` off): perps on Hyperliquid and prediction markets on Polymarket, through accounts the customer's own wallet owns, with no Aura fee and no sports markets ([markets](../architecture/markets.md)). Two sections in the menu, Perps (`/app/perps`) and Predictions (`/app/predictions`); old `/app/markets` links redirect. They place an order in one tap, adding money and setting up the account first when needed.
- **Overview, Transactions, and Insights.** Chain-read balances in US dollars with source and observation time; Transactions with money received (Alchemy's transfer index), card activity, receipts grouped by day, CSV exports, and a monthly statement that is refused rather than incomplete; a summary at the top of Transactions (once the Insights page) whose totals narrow the list, with a money in and out chart and top card merchants on request ([screen data](../architecture/frontend-data.md)).
- **Aura tags.** A unique, non-transferable tag, a verified linked receiving wallet, public opt-in, and a public crypto payment page.
- **Provider projections** for Bridge customers, bank payouts, cards, and wallet-provider rules, applied from signed provider events by the events Worker ([provider projections](../architecture/provider-projections.md)).
- **Notifications** (`lib/notifications`): a header bell, toasts, email through Resend, and browser push. Security notices are always emailed; transaction notices follow the customer's choices.
- **Privacy and closing.** Notification choices, product-update consent, and an instant data download backed by the classified inventory in `lib/privacy/subject-data.ts`. No customer deletion: an operator closes an account on request once it holds no funds (`lib/account/closure.ts`).
- **Support** through Intercom (`lib/support/intercom.ts`, `components/support-chat.tsx`): the Messenger with Fin answering first, identified by a server-signed JWT, with a read-only data connector for the latest transactions; report-a-problem paths. Chat shows as unavailable when Intercom's script doesn't load. There's no support channel for people who can't sign in, or when chat is down, until Aura has its own email domain.
- **Operations app** (`apps/ops`), a separate Worker behind Cloudflare Access ([architecture](../architecture/architecture.md#operations-app), [runbook](../operations/operations-runbook.md#operations-app)).
- **Database.** `infra/d1/migrations/0001_baseline.sql` (squashed from 42 migrations on 25 September 2026), then `0002_incoming_observations.sql`, `0003_card_observations.sql`, `0004_notification_delivery_claims.sql`, `0005_bank_beneficiary_available_at.sql`, `0006_wallet_deposits.sql`, and `0007_markets.sql`. Migrations are append-only on dev since 28 September 2026 ([development Worker](../operations/aura-development-worker.md#database)). No production database exists.

Funded transactions run on dev are listed in the [development Worker](../operations/aura-development-worker.md#what-has-and-has-not-been-exercised) doc.

## Removed

- **25 September 2026** (see the [codebase audit](codebase-audit-2026-09-25.md)): borrowing, the support assistant, the partner sandbox and demo provider, regulated market orders and eligibility, the portfolio history and tax-lot pipeline, and the previous transaction pipeline. `/app/borrow` redirects to Earn.
- **Earlier:** the customer waitlist, markets lists, price alerts, goals, scheduled transfers, paycheck planning, external-wallet portfolio tracking, lifestyle concierge, the private-beta invitation gate, and Aura-computed membership tiers. Audit evidence, consent records, and beta invitations remain.
- **27 September 2026:** Invest; stocks and gold are bought in Swap.
- **28 September 2026:** Rewards (no provider reports memberships or benefits; `/app/rewards` and `/app/benefits` open Cards), in-house support cases, feedback, Turnstile, the public status and incident routes, the console inside the customer app, and `GET /api/ops/analytics`.

## External or incomplete

| Area | Required before customer execution |
| --- | --- |
| Bridge bank deposits and payouts | Built behind `fiat_accounts` and tested against a local Bridge fake. Needs Bridge approval, `BRIDGE_API_KEY`, `BRIDGE_WEBHOOK_PUBLIC_KEY`, a registered webhook, and a sandbox run ([partner integration](../architecture/partner-integration.md#bridge-activation)) |
| Bridge + Stripe Issuing cards | Built behind `payment_cards` (phone wallets behind `card_wallets`) and tested against local fakes. Needs an approved Bridge card program, a Stripe account, `BRIDGE_CARDS_SPENDER`, a registered Stripe webhook, and a real card on dev. Apple and Google Pay need Stripe preview access |
| Card payments on Aura tag pages | Acquiring or payment-link provider, recipient onboarding, payment state, refunds, and disputes |
| Account and gas sponsorship | Privy dashboard: Google and Telegram sign-in turned on, TEE execution, gas sponsorship on every network Aura sends from, and MFA with passkeys or authenticator apps |
| Funded actions | Routes not yet run with real funds on dev need a funded rehearsal |
| Sign-in recovery and remote sessions | Privy's recovery and session controls, exercised in the [acceptance plan](../operations/acceptance-test-plan.md) |
| Syrup (Maple) in Earn | Deferred: deposits need Maple's per-wallet authorization, and withdrawals queue for up to 30 days |
| Card cashback | Cut with Rewards. May return once cards are live, with a funded provider program |
| Notifications in production | A verified Resend sending domain, `EMAIL_FROM`, `APP_ORIGIN`, and its own VAPID key pair |
| Production release | The steps in [production launch](../operations/production-launch.md) and the gates in [launch readiness](launch-readiness.md) |

Providers, chains, and protocols are authoritative for balances and settlement; D1 projections never are.
