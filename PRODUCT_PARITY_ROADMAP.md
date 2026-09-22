# Aurel Product Parity Roadmap

Last reviewed: 2026-09-22

## Product position

Aurel should feel familiar to a Revolut customer and capable to an experienced onchain user. The product is organized around customer jobs, not providers or networks:

- **Add money** — bank transfer, card funding when enabled, or digital assets.
- **Send** — to a person, bank account, or wallet.
- **Swap** — exchange one asset for another, including cross-network routing when required.
- **Withdraw** — move money to a bank account or an external wallet.
- **Grow** — compare and enter yield positions with explicit risk and liquidity.
- **Pay** — manage virtual and physical cards, funding priority, limits, and disputes.

Networks are routing details. Aurel may reveal them when the customer must choose an address format, pay a fee, or review a transaction, but they are not primary navigation.

## Verified benchmark

| Capability | Ether.fi Cash | Plasma One | KAST | Revolut pattern | Aurel status |
| --- | --- | --- | --- | --- | --- |
| One portfolio with value history | Portfolio and live borrow state | Stablecoin balance | Store/earn/move/spend account | Balance analytics and insights | **In progress:** live onchain balances and portfolio chart |
| Add digital assets from multiple networks | Supported token deposits and multichain top-up | Stablecoin transfers | Crypto and stablecoin deposits | Crypto deposit where eligible | **Available for USDC:** automatic route discovery across supported networks; each route is user-approved |
| Withdraw to another network/address | Token withdrawal with Safe approvals | Wallet withdrawal | Stablecoin withdrawal | Crypto withdrawal where eligible | **In progress:** destination-aware LI.FI routes and direct sends |
| Swap/trade | 100+ tokenized crypto, metals, and stock assets; quote comparison | Stablecoin-focused | Deposit/swap BTC, ETH, SOL to USDC | Crypto, equities, commodities, FX | **Partial:** USDC cross-network routing; live market discovery now precedes broader asset execution |
| Bank account and transfers | Bank transfer rails | Bridge-powered global account | ACH and Fedwire account details | Local accounts, transfers, direct deposit | **Provider-ready preview:** Bridge adapter boundary and non-authoritative projections |
| Card | Virtual/physical Visa; Direct Pay and Borrow modes | Virtual/physical card; tier rewards | Global card and auto-conversion | Virtual/disposable/physical cards and controls | **Provider-ready preview:** card surface and controls; issuance remains partner-gated |
| Earn | Liquid vaults and staking | Opt-in DeFi yield | Risk-adjusted vaults | Savings by jurisdiction | **Live:** governed Aave supply flow with direct wallet confirmation |
| Borrow | Collateralized borrowing and card Borrow mode | — | — | Consumer credit by jurisdiction | **Live:** Aave simulation, health factor, borrow, and repay |
| Rewards and membership | Balance/activity membership tiers and cashback | Tiered cashback and benefits | Cashback and partner collaborations | Paid plans, RevPoints, partner benefits | **Preview:** balance/activity tier model, benefits, referrals, concierge |
| Card controls | Limits, PIN, freeze, spend priority, disputes | Freeze and account lock | App card controls | Freeze, limits, merchant controls, disposable cards | **Provider-ready:** full control workspace and projection contract; all actions remain setup-gated until issuer connection |
| Security | Passkeys/Safe owners and explicit signatures | Biometrics and hardware-backed keys | Identity, device security, monitoring | biometrics, limits, scam intervention | **Strong baseline:** Privy authentication, passkeys, policy evaluation, allowlists, recovery, audit trail |
| Joint/shared money | — | P2P transfer | Business/team movement | Joint accounts, Pockets, subscriptions | **Partial:** approval-required schedules and recipient directory; shared ownership, pockets, and provider-executed bills remain gaps |

Sources: [Ether.fi Help Center](https://help.ether.fi/en/), [Ether.fi swaps](https://help.ether.fi/en/articles/776157-how-swaps-work-on-ether-fi), [Plasma One](https://www.plasma.to/insights/introducing-plasma-one-the-one-app-for-your-money), [KAST](https://www.kast.xyz/), [Revolut 2025 annual report](https://assets.revolut.com/pdf/annualreport2025.pdf), and current Aurel code and provider contracts.

## Naming contract

Use these labels consistently in navigation, quick actions, dialogs, receipts, support, and documentation:

| Customer intent | Primary label | Avoid as the primary label |
| --- | --- | --- |
| Bring value into Aurel | Add Money | Bridge, Fund Wallet, On-ramp |
| Pay another person or address | Send | Transfer Assets, Execute |
| Exchange assets | Swap | Exchange, Route, Cross-chain |
| Take value out of Aurel | Withdraw | Off-ramp, Redeem |
| Receive account details/address | Receive | Deposit Address Generator |
| Put assets to work | Earn | Supply (allowed only in protocol review details) |
| Use collateral | Borrow | Credit Facility (allowed in legal documentation) |
| Inspect owned value | Portfolio | Assets Overview |

## Delivery sequence

### P0 — familiar money movement and portfolio

- [x] Secure wallet connection and embedded account.
- [x] Receive and direct send modals.
- [x] Explicitly approved USDC routing from supported networks.
- [x] Unified **Add Money**, **Send**, **Swap**, and **Withdraw** entry points.
- [x] Destination-aware USDC withdrawals to supported networks.
- [x] Portfolio value, period selector, line chart, allocation, and authority state.
- [x] Live searchable markets list with watchlist and clear execution availability.
- [x] Consistent Review, Confirm, Submitted, Complete, failure, and receipt states across direct sends, routed Add Money/Withdraw, Earn, Borrow, and Repay, with authenticated source-receipt reconciliation.

### P1 — daily financial account

- [ ] Recipient directory shared by bank and wallet sends. Wallet recipients are live; bank recipients await provider projections.
- [x] Saved wallet recipients, recent destinations, and verified-address indicators.
- [ ] Scheduled and recurring transfers. Approval-required plans are live; automatic/provider-managed execution remains gated.
- [ ] Bills and subscriptions view. Reminder planning and provider-observed subscription projections are live; provider-authorized autopay remains gated.
- [ ] Categories, merchant enrichment, search, filters, and statement export. Aurel activity categories, search, filters, CSV export, and period insights are live; merchant enrichment and issuer statements remain provider-gated.
- [ ] Pockets/goals backed by provider or onchain subaccounts, never a local ledger. Planning-only goals are live and deliberately show no current balance until an authoritative source is linked.
- [ ] Card funding priority, freeze, per-card limits, PIN, replacement, disputes, and statements through issuer APIs. The complete provider-ready UI and card projection contract are live; mutations remain issuer-gated.
- [ ] Salary/direct-deposit setup and automatic allocation rules. Provider-ready Direct Deposit and planning-only Payday Plans are live; account issuance, income recognition, and execution remain provider-gated.

### P2 — wealth and membership

- [ ] Broader swap universe with multi-provider quote comparison. Twelve curated assets and live LI.FI-routed comparison across available 1inch, KyberSwap, SushiSwap, and Nordstern routes are live; more assets and independent direct-provider fallbacks remain.
- [ ] Jurisdiction- and eligibility-aware tokenized market execution.
- [ ] Consolidated DeFi positions, claimable rewards, cost basis, realized/unrealized return, and tax export. Live Aave position summary is now shown in Portfolio; broader protocols, rewards, performance accounting, and tax export remain.
- [ ] Spend-from-yield and collateral-backed card modes only after provider and legal approval.
- [ ] Membership rewards ledger backed by the rewards provider, with transparent caps and qualification history.
- [ ] Joint, family, and business accounts only when ownership and authority are provider-enforced.

## Non-negotiable invariants

- Aurel never invents a balance, transaction state, price, entitlement, or provider capability.
- Onchain contracts and regulated providers remain authoritative; D1 contains disposable projections, workflow state, rate limits, and audit evidence.
- No transfer can be submitted without current authentication, policy evaluation, simulation where available, and the customer’s wallet or provider confirmation.
- A cross-network receive is not described as automatic unless the route has been quoted and the customer has approved it.
- Provider-gated features may be fully designed and exercised with contract-valid fixtures, but must be labeled setup-required until the production provider reports availability.
- Eligibility, invitations, recovery, financial authority, and security controls cannot be bypassed by a new shortcut or modal.

## Completion criteria

Each checked item requires unit coverage for decision logic, an accessible keyboard path, responsive desktop/mobile verification, truthful empty/error/loading states, documentation, and a production smoke check when deployed.
