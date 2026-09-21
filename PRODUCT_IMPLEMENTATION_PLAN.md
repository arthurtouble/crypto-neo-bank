# Product and implementation plan

Research and planning date: 21 September 2026  
Status: working product specification for review before implementation  
Primary launch architecture: Privy + Bridge + direct, curated DeFi integrations  
Card/payment fallback: Rain  

> This document is a product and technical plan, not legal, tax, regulatory, or investment advice. Product availability, permitted marketing, jurisdictions, and responsibility splits must be confirmed in signed provider agreements and jurisdiction-specific legal review.

---

## 1. Executive decision

Build a web-first **financial operating system for onchain wealth**.

The initial product should not be presented as a literal bank, a crypto exchange, or a generic “everything app.” Its first promise should be simple and memorable:

> **Your onchain wealth, usable everywhere.**

Supporting proposition:

> Receive digital dollars, keep idle money productive, spend globally, and understand your entire onchain balance sheet from one secure account.

The product should begin with a narrow, high-value loop:

```text
Receive money → Hold it safely → Earn on an opted-in allocation → Spend or transfer it
```

The infrastructure can remain unusually lean:

- **Privy**: identity/authentication, embedded noncustodial wallets, key management, policies, funding UI, transaction execution, and initial yield integrations.
- **Bridge**: customer KYC/KYB, fiat/stablecoin conversion, named virtual accounts, local payment rails, card program, and the regulated portion of money movement.
- **Direct DeFi adapters**: curated yield, swaps, collateralized borrowing, and later permissioned tokenized-asset markets.
- **Optional benefits vendors**: card-linked merchant rewards, lounges, travel insurance, eSIM, and concierge. These are phased additions, not MVP blockers.

This architecture can provide most of the desired experience without building custody, banking rails, card processing, or protocol infrastructure from scratch.

### Product principles

1. **Independent and asset-agnostic.** No house token and no forced ecosystem allegiance.
2. **Safety is visible.** Every position explains custody, counterparties, liquidity, permissions, risks, and net return.
3. **Progressive trust.** Users can connect, observe, and test with small amounts before consolidating assets.
4. **Productive by choice, not by concealment.** Yield is explicit, opt-in, reversible, and never described as a bank deposit.
5. **One coherent experience, honest legal boundaries.** The interface can be unified without pretending that fiat accounts, self-custodied assets, DeFi positions, and cards are legally identical.
6. **Premium restraint.** The product should feel permanent, quiet, and precise—not promotional, gamified, or token-driven.
7. **Automation with customer control.** Policies propose and execute only within permissions the customer understands and can revoke.

---

## 2. Target customer and jobs to be done

### Initial ideal customer

A globally mobile, crypto-native professional, founder, investor, or small-company principal with approximately $25,000–$500,000 of digital-asset exposure who:

- receives income, distributions, or proceeds in stablecoins;
- regularly moves money between wallets, exchanges, and bank accounts;
- travels or transacts across currencies;
- wants yield without making all money illiquid;
- has assets fragmented across chains and protocols;
- values security, reporting, and fast support;
- is willing to pay for meaningful convenience and control; and
- will initially test a new product with a modest amount rather than transferring their whole portfolio.

### Core jobs

1. **Receive** salary, invoices, transfers, and crypto into one usable account.
2. **See** the complete financial position across the product and connected wallets.
3. **Protect** assets with understandable permissions, limits, and recovery.
4. **Earn** on selected idle balances without losing sight of liquidity and risk.
5. **Spend** stablecoins anywhere cards are accepted.
6. **Move** value between chains, wallets, bank accounts, and recipients with minimal friction.
7. **Plan** liquidity, taxes, protocol exposure, and recurring obligations.
8. **Get help** from an intelligent concierge that can resolve operational problems, not merely answer generic questions.

### Explicitly not the initial customer

- anonymous or KYC-averse users seeking to evade regulated onboarding;
- high-frequency speculative traders;
- customers in unsupported or sanctioned jurisdictions;
- users primarily seeking unsustainably high cashback;
- users expecting guaranteed yield or principal protection; or
- institutions requiring qualified custody from day one.

---

## 3. Positioning and differentiation

### Category

External category language:

> **The financial operating system for onchain wealth.**

Internal analogy:

> Revolut’s product coherence, rebuilt around customer-controlled wallets and stablecoin rails.

Avoid leading with “crypto bank,” “private bank,” “savings,” “deposit yield,” or “everything app” unless approved for a specific jurisdiction and context.

### Differentiating promises

#### 1. Independent and aligned

- No native token.
- No requirement to hold an ecosystem asset.
- Support assets and protocols based on utility, liquidity, and risk criteria.
- Show every fee and revenue-sharing arrangement.
- Rank opportunities by customer-adjusted risk and net outcome, not by what pays the platform most.

The brand should communicate alignment through behavior rather than repeatedly claiming it.

#### 2. Safety as a product surface

For every asset and strategy, show:

- custody/control model;
- issuer and smart-contract exposure;
- chain and bridge exposure;
- oracle and liquidation dependencies;
- liquidity and expected exit time;
- historical, current, and promotional rates;
- net return after known fees;
- concentration relative to the user’s portfolio;
- relevant audits and incident history; and
- a plain-language “what could cause loss?” explanation.

Controls should include:

- passkeys and step-up authentication;
- new-device cooling periods;
- allowlisted recipients and contracts;
- daily and per-transaction limits;
- delayed large withdrawals;
- transaction simulation;
- approval requirements for selected actions;
- emergency recovery and lock procedures;
- revocable card allowances isolated from investment assets; and
- optional multisig for family and organization accounts.

#### 3. One productive, liquid relationship

Customers can maintain a spending reserve and allocate excess stablecoins to selected liquid strategies. The product explains exactly which portion is immediately available and which must be withdrawn before spending.

No “automatic yield” should be enabled without affirmative consent and clear risk disclosures.

#### 4. Unified onchain balance sheet

Aggregate:

- Privy wallets;
- connected external wallets;
- supported DeFi positions;
- stablecoins;
- loans and collateral;
- fiat/stablecoin virtual-account activity;
- card balances and pending transactions; and
- later, permissioned tokenized assets.

The user should be able to answer:

- How much is liquid now?
- What can safely be spent?
- Where is each asset held?
- Which protocol, issuer, chain, or counterparty dominates my risk?
- What happens if ETH or a collateral asset falls materially?
- What should be moved, repaid, or rebalanced?

#### 5. Personal treasury policies

Examples:

- Keep $10,000 immediately spendable.
- Allocate excess eligible USDC to a named strategy.
- Never expose more than 20% of assets to one protocol.
- Require confirmation above $25,000.
- Repay debt if health factor approaches a defined boundary.
- Set aside a percentage of realized proceeds for taxes.
- Rebalance stablecoin issuer exposure when a threshold is exceeded.

Policies begin as recommendations. Automated execution is introduced only after explicit, revocable delegation and extensive safety testing.

#### 6. Family and company controls

- Household and entity views.
- Additional cards and spending pockets.
- Read-only accountant access.
- Spouse, partner, or cofounder approvals.
- Allowances and purpose-limited wallets.
- Organization roles and approval thresholds.
- Emergency contacts and succession preparation.

### What is and is not a moat

| Capability | Acquisition value | Long-term defensibility |
|---|---:|---:|
| Elegant design | High | Low alone |
| Metal card | Medium | Very low |
| Lounge access | Medium | Low |
| High cashback | High | Low and expensive |
| Privy/Bridge integration | Required | Low |
| Reliable execution | High | Medium |
| Brand and demonstrated trust | Very high | High over time |
| Consolidated financial data | High | Medium–high |
| Personalized policies and automation | High | High |
| Risk/security intelligence | Very high | High |
| Family and organization workflows | High | Medium–high |
| Distribution partnerships | Very high | High |
| Future collateral/credit intelligence | High | Potentially high |

The moat compounds from trust, normalized financial data, saved policies, security operations, workflow history, distribution, and superior economics—not from API access.

---

## 4. Membership and loyalty model

Do not require a large opening balance. Let customers qualify for tiers through one of three aligned routes:

1. **Pay** for membership.
2. **Hold** an eligible time-weighted productive balance.
3. **Use** the product enough to create sustainable contribution margin.

### Proposed tiers

| Tier | Subscription route | Balance route* | Activity route* | Core benefits |
|---|---:|---:|---:|---|
| Essential | Free | None | None | Wallet, portfolio, virtual account eligibility, virtual card eligibility, transfers |
| Plus | $20/month | $10K | $2K monthly card spend | Physical card, enhanced support, basic travel bundle, better limits |
| Black | $100/month | $50K | $7.5K monthly card spend | Metal card, lounge allocation, travel protection, priority service, advanced policies |
| Private | $300/month or invite | $150K–$250K | Contribution-based | Concierge, family/entity features, security review, custom reporting, premium experiences |

\* Illustrative thresholds subject to provider economics. Use 30- or 90-day time-weighted measurements, not point-in-time balances.

### Relationship score

The score may incorporate:

- eligible average balance;
- card spend;
- membership payments;
- tenure;
- funded transaction activity;
- use of revenue-generating services; and
- verified connected assets for recognition only.

Do not fund costly benefits purely from external wallet balances that generate no revenue. Do not let points obscure the direct path to a benefit.

### Reward principles

- Base cashback should be modest and sustainable.
- Prefer merchant-funded offers and targeted campaigns.
- Cap promotional cashback by month and category.
- Reward safe, valuable behavior: tenure, direct deposit, recurring funding, and use of productive balances.
- Avoid a speculative loyalty token.
- Show points in an understandable fiat-equivalent redemption value.
- Calculate a benefit budget per customer from actual contribution margin.

---

## 5. Product scope

### 5.1 Public website

- Positioning and trust narrative.
- Clear explanation of self-custody and provider roles.
- Product tour.
- Security architecture.
- Transparent fee schedule.
- Supported-country waitlist.
- Membership comparison.
- Provider and risk disclosures.
- Documentation, status, and incident links.
- Application/waitlist funnel without soliciting deposits.

### 5.2 Authentication and onboarding

- Email, passkey, and supported social authentication through Privy.
- Mandatory passkey enrollment before material value movement.
- Device registration and session management.
- Terms and privacy consent versioning.
- Wallet creation.
- Optional read-only connection of external wallets.
- Progressive profile setup.
- Bridge-hosted or embedded KYC once the customer activates regulated services.
- KYC/KYB state machine: not started, pending, needs information, approved, rejected, restricted.
- Product/rail endorsement states shown honestly.
- Country and feature eligibility matrix.

Users should be able to explore the self-custodial interface before regulated activation. Bank details, cards, and regulated transfers remain locked until required verification succeeds.

### 5.3 Home and net-worth dashboard

- Total relationship value.
- Immediately spendable amount.
- Productive/yielding allocation.
- Borrowed amount and collateral health.
- Allocation by asset, chain, protocol, issuer, and liquidity.
- Recent transactions across wallet, account, and card.
- Upcoming obligations and scheduled actions.
- Risk notices and recommended actions.
- Membership status and next meaningful benefit.

### 5.4 Wallet and asset management

- Privy embedded noncustodial wallet.
- EVM support first; add Solana only when product demand justifies the operational surface.
- Receive, send, swap, and bridge approved assets.
- Address book with ownership labels.
- Address allowlisting.
- Transaction simulation and fee preview.
- Export/recovery paths consistent with the selected Privy configuration.
- Optional Safe account for households and organizations requiring multiple approvers.
- No platform-controlled unilateral transfer capability in the default consumer design.

### 5.5 Fiat and stablecoin accounts through Bridge

- Named virtual account details where approved.
- ACH, wire, SEPA, Faster Payments, or other rails only where endorsed.
- Automatic conversion of incoming fiat to the selected supported stablecoin where applicable.
- Stablecoin-to-fiat withdrawals.
- Beneficiary management.
- Transfer quote including fees, FX, and estimated arrival.
- Transfer state timeline.
- Receipts and downloadable confirmations.
- Provider terms and legal ownership clearly displayed.

Bridge virtual accounts must not be described as conventional bank deposit accounts unless the signed program permits that description.

### 5.6 Card

- Virtual card after approval.
- Physical card after controlled launch.
- Freeze/unfreeze.
- Spending limits and category/geography controls.
- Transaction history and merchant enrichment.
- Card funding pocket or constrained just-in-time allowance.
- Pending, reversed, captured, refunded, disputed states.
- Apple Pay/Google Wallet if enabled by the card program.
- Cardholder support and dispute handoff.
- Rewards and tier benefits.

Primary path: Bridge/Stripe managed card components exposed through Privy where commercially available.  
Fallback/upgrade: Rain-managed card program.

### 5.7 Earn

- Curated strategies only.
- User-directed deposit and withdrawal.
- Explicit risk card before confirmation.
- Gross APY, platform/provider fee, and estimated net APY.
- Position value, accrued return, liquidity, and withdrawal state.
- Exposure map by protocol, chain, asset issuer, and vault curator.
- Strategy pause and emergency exit handling.
- No guarantees and no “savings account” terminology.

Initial strategy count should be one or two, not a marketplace. Quality and comprehensibility are the product.

### 5.8 Borrow

Phase 2, after Earn is stable:

- User-initiated overcollateralized borrowing through approved DeFi protocols.
- Collateral and debt visualization.
- Health factor and liquidation buffer.
- Stress scenarios.
- Repayment and collateral withdrawal.
- Alerts and optional protective policies.
- No platform balance-sheet lending in the initial product.

### 5.9 Tokenized assets

Phase 3, technically executed as customer-directed transactions from Privy wallets into approved onchain venues/contracts.

- Discovery and market data.
- Eligibility and jurisdiction gating.
- Contract/issuer disclosure.
- Customer-directed buy/sell/transfer.
- Portfolio and performance reporting.
- Trading-hours and liquidity messaging where applicable.

**Important boundary:** Privy can provide the wallet and execution mechanism; it does not itself make a tokenized stock non-security or authorize the application to solicit, recommend, route, or receive transaction-based compensation. The baseline plan does not add a separate brokerage integration, as requested, but no tokenized-equity UI should ship until the exact asset, issuer, venue, geography, promotion, and platform role have been reviewed. Where a token or venue is permissioned, its issuer/venue remains a required dependency even if no additional API aggregator is used.

### 5.10 Rewards and benefits

Benefits should be adapter-based so vendors can change without changing membership logic.

#### Launch benefits

- Membership status.
- Platform-funded capped cashback.
- Referral credit after verified, funded activation.
- Priority support.
- Physical/premium card by tier.

#### Merchant-funded rewards

Candidates:

- **Kard**: cardholder enrollment, merchant offers, transaction matching, reward webhooks, and reconciliation.
- **Fidel API**: card-linked transactions and offers across multiple markets.
- **Rain Rewards**: preferable if Rain becomes the card provider.

Do not integrate both Kard and Fidel initially. Select based on target countries, card-program compatibility, offer inventory, privacy, prefunding, and commercial terms.

#### Travel and lifestyle

| Benefit | Primary candidate | Alternative/notes |
|---|---|---|
| Lounges, Fast Track, dining | DragonPass API | Priority Pass/Collinson commercial program |
| Travel and purchase protection | Cover Genius / XCover API | Qover or card-network benefits depending geography |
| eSIM | 1GLOBAL Connect API | Airalo Partners or card-network bundle |
| Human lifestyle concierge | Ten Lifestyle Group | Introduce only for Private tier |
| Hotels/travel offers | Concierge or network partner | Avoid becoming merchant of record initially |

Benefits should launch in this order: merchant-funded offers, a small lounge allocation, eSIM, then insurance and concierge. Insurance and concierge carry the most contractual, servicing, and geographic complexity.

### 5.11 AI financial concierge

Initial capabilities:

- Explain balances, positions, and transactions.
- Answer product and risk questions from approved documentation.
- Create draft transfer or policy intents for user confirmation.
- Generate monthly financial summaries.
- Surface concentration and liquidity risks.
- Prepare support and dispute cases.
- Explain why an action is blocked or pending.
- Escalate to a human/provider workflow.

Never let an AI agent move money without deterministic policy checks and the required customer confirmation. AI output must not be the source of truth for balances, eligibility, fees, or transaction state.

### 5.12 Documentation and trust center

- Product guides.
- Wallet and recovery model.
- Fiat/account/card provider roles.
- Supported countries and products.
- Asset and protocol methodology.
- Strategy risk explanations.
- Fees and spreads.
- Status and incident history.
- Security controls and responsible disclosure.
- API documentation later if external platform APIs are offered.
- Changelog with effective dates.

---

## 6. Provider architecture

### Base providers

#### Privy

Use for:

- login and user authentication;
- embedded noncustodial wallets;
- passkeys and MFA-compatible flows;
- signing and transaction execution;
- wallet policies and delegated permissions;
- gas sponsorship;
- wallet funding UI;
- Bridge integration;
- managed card UI where available; and
- initial vault/yield integrations.

Do not assume the public MAU price includes Bridge, card, KYC, conversion, gas, or DeFi-provider fees. High-value customers may exceed Privy’s included transaction-volume threshold with few users.

#### Bridge

Use for:

- customer KYC/KYB for regulated services;
- applicable terms acceptance;
- USD/EUR/GBP or other approved virtual accounts;
- fiat/stablecoin conversion;
- onramps and offramps;
- local payment rails;
- customer/product endorsements;
- card KYC and card-program management where approved; and
- transaction/compliance decisions within Bridge’s perimeter.

Bridge must approve both the company/program and each customer. Starter pricing with no monthly commitment, if contractually available, reduces fixed cost but does not guarantee cards, every geography, unlimited volume, or zero reserve requirements.

### Rain as alternative or second-stage card provider

Prefer Rain if Bridge cannot deliver:

- the required issuing countries;
- a premium/metal card experience;
- suitable interchange economics;
- consumer credit/prepaid structures required by the roadmap;
- rewards integration; or
- the desired managed operational model.

Do not launch Bridge and Rain cards simultaneously. Implement a `CardProvider` boundary so migration or regional routing is possible later.

### Safe

Safe is not a default replacement for Privy. It is an optional smart-account layer for:

- households;
- organizations;
- multiple approvers;
- inheritance/succession patterns; and
- advanced recovery or permissions.

Privy remains the signer/authentication layer unless customers bring external signers.

### Protocol and data dependencies

- EVM interaction: `viem` and `wagmi`.
- Primary RPC/indexing provider: Alchemy or QuickNode.
- Secondary RPC for failover on money-critical reads.
- Onchain price source: protocol-native/Chainlink where relevant.
- Display-market data: a replaceable provider adapter.
- Protocol adapters: begin with a single lending/yield protocol and a single routing path.
- Transaction simulation/security: Privy policies plus an independent simulation/risk service where needed.
- Wallet/contract screening: provider selected with Bridge approval for activity outside Bridge’s direct perimeter.

### Provider abstraction rule

Every external provider is called through an internal adapter exposing normalized commands, queries, events, and errors. Product code must not depend directly on provider-specific response objects.

Required adapters:

- `WalletProvider`
- `FiatRailProvider`
- `IdentityVerificationProvider`
- `CardProvider`
- `ProtocolAdapter`
- `RewardsProvider`
- `BenefitsProvider`
- `MarketDataProvider`
- `NotificationProvider`

---

## 7. Technical architecture

### Architecture style

Start as a **modular monolith** with strict domain boundaries. Do not begin with microservices.

```text
Web application + documentation
              │
       API / BFF boundary
              │
┌───────────────────────────────────────────┐
│ Modular application                       │
│                                           │
│ Identity   Portfolio   Wallets   Policies │
│ Funding    Transfers   Cards     Earn     │
│ Rewards    Benefits    Support   Reporting│
│                                           │
│ Workflows + disposable projections + audit│
└───────────────────────────────────────────┘
       │          │           │
     Privy      Bridge       DeFi/RPC
                   │
                 Rain (optional card path)
```

### Monorepo

Use `pnpm` workspaces. Keep the first release in one Cloudflare-deployable application and split packages only when a boundary has earned its complexity:

```text
apps/
  web/                 vinext customer app, docs, API, webhooks, and ops UI
  docs/                MDX documentation/trust center
packages/
  design-system/       Tokens and accessible UI components
  domain/              Domain models, money types, state machines
  providers/           Privy, Bridge, Rain, rewards, benefits adapters
  projections/         Rebuildable provider/on-chain read models
  policies/            Deterministic authorization/risk rules
  observability/       Logging, tracing, metrics, redaction
  config/              Validated environment configuration
  testkit/             Fixtures, provider simulators, contract tests
```

### Frontend

- vinext, React, and TypeScript, deployed natively to Cloudflare Workers.
- Privy React SDK.
- `wagmi` + `viem` for EVM wallet state and transactions.
- TanStack Query for server state.
- React Hook Form + Zod for forms and validation.
- Radix primitives with a fully custom visual layer.
- CSS variables and design tokens; Tailwind may be used as the token utility layer.
- Recharts or Visx for restrained portfolio visualization.
- Storybook for the design system.
- Playwright for critical user journeys.
- No financial truth calculated only in the browser.

### Backend and source-of-truth model

- Cloudflare Workers host route handlers, server components, provider adapters, and signed webhook endpoints.
- Cloudflare Workflows handle resumable, multi-step provider operations; Queues buffer webhook bursts and refresh jobs only when volume requires them.
- D1 is optional and contains rebuildable projections, user preferences, benefit entitlements, consent receipts, provider-object references, and operational annotations.
- KV or Workers Cache may hold short-lived quotes, feature configuration, and read-through caches. Neither stores financial truth.
- R2 is optional for generated exports and encrypted operational evidence. Provider-hosted statements remain preferred.
- Secrets live in Workers Secrets, never source code or checked-in environment files.
- OpenAPI is generated from validated schemas at the Worker/API boundary.
- No service maintains a core-banking ledger or independently asserts customer balances.

### Authoritative-data model

- Bridge or Rain is authoritative for fiat accounts, KYC status, transfers, cards, and card transactions in the product scope they serve.
- Privy and its configured signer/custody model are authoritative for wallet provisioning and signer policy state.
- The blockchain is authoritative for wallet balances, transaction settlement, DeFi positions, debt, and tokenized on-chain assets.
- Market-data providers are authoritative only for presentation prices; values are timestamped and never treated as settlement truth.
- Our read model joins provider IDs, chain IDs, and timestamps into a customer-friendly view. It can be deleted and rebuilt by replaying provider APIs, signed webhooks, and chain indexers.
- Idempotency records and workflow state prevent duplicate commands, but do not create balances.
- A user-facing value always retains provenance (`provider`, `chain`, `asOf`, `status`) so stale or unavailable sources can be shown honestly.
- Provider reconciliation detects display or workflow drift. It does not attempt to reconcile against a second internal book.

### Core data entities

- User, Profile, Device, Session
- LegalEntity, Verification, Endorsement
- Wallet, Address, Signer, WalletPolicy
- Asset, Chain, Protocol, Contract
- ExternalAccountReference, BalanceSnapshot, PositionProjection
- TransferIntent, Transfer, ProviderTransfer
- Cardholder, Card, CardTransaction, Dispute
- Strategy, StrategyVersion, PositionLot
- LoanPosition, CollateralPosition, RiskSnapshot
- Membership, QualificationWindow, BenefitEntitlement
- RewardOffer, RewardEvent, RewardSettlement
- ProviderEventReceipt, ProjectionCheckpoint, ReconciliationRun
- Consent, DisclosureVersion, AuditEvent
- SupportCase, ComplianceRequest, Incident

### Infrastructure and deployment

#### Demonstration phase

- One Cloudflare Worker deployment serves the web app, documentation, API, and signed sandbox webhooks.
- Workers Static Assets serves immutable client assets at the edge.
- Privy sandbox/testnet and provider simulators only; no real customer money.
- No database is required for the first public demo. Deterministic fixtures make every demo state reproducible.
- Local, preview, sandbox, and production-like demo environments use separate Worker variables and secrets.

#### Production target

- Cloudflare Workers + Static Assets remain the primary compute and delivery platform.
- Workflows provide durable orchestration for operations that span approvals, provider callbacks, or chain confirmations.
- Queues isolate bursty webhooks and asynchronous projection refreshes when needed.
- D1/KV/R2 are introduced only for the non-authoritative uses listed above and can be rebuilt or restored without changing customer financial ownership.
- Turnstile, WAF, rate limiting, Bot Management, and API Shield are added according to the public attack surface and plan eligibility.
- Workers Secrets hold provider credentials; production, sandbox, and preview use separate Cloudflare environments and provider programs.
- Workers Logs and Traces use strict redaction and never record KYC payloads, secrets, full wallet identifiers, or sensitive financial amounts.
- Infrastructure configuration is versioned through Wrangler; an infrastructure-as-code layer can be added when account-level resources outgrow the application config.

The operational recovery objective is explicit: losing every Aurel projection must inconvenience the team, not lose customer money or alter a customer balance. The application is restored by reconnecting provider references and rebuilding from authoritative APIs and chains.

### Observability

- OpenTelemetry traces and metrics.
- Sentry for frontend/backend exceptions with strict data scrubbing.
- Central structured logs with correlation, user, intent, and provider-event IDs.
- Provider latency/error dashboards.
- Projection freshness and provider reconciliation alerts.
- Security alerts for new devices, failed step-up, policy denials, and abnormal transfers.
- Status page with component-level incidents.
- Product analytics configured to exclude wallet addresses, financial amounts, KYC data, and secrets unless specifically justified.

---

## 8. Security architecture

### Threat model priorities

1. Account takeover.
2. Malicious or compromised destination.
3. Provider credential compromise.
4. Admin privilege abuse.
5. Smart-contract exploit.
6. Incorrect transaction construction.
7. Webhook forgery/replay.
8. Ledger/reconciliation error.
9. Supply-chain compromise.
10. Sensitive-data leakage through logs, analytics, or AI systems.

### Required controls

- Passkeys strongly preferred; step-up for sensitive actions.
- Short-lived server tokens and rotated credentials.
- Device binding and new-device cooling period.
- Deterministic policy engine outside the AI layer.
- Provider webhook signature verification, timestamp validation, replay protection, and durable capture before processing.
- Idempotency keys on every money-moving operation.
- Transaction-intent state machines.
- Contract and recipient allowlists/denylists.
- Simulation before onchain signing.
- Value/velocity thresholds and anomaly detection.
- Privileged-action dual control for production.
- No production access through shared credentials.
- Append-only audit events.
- Dependency pinning, SAST, secret scanning, SBOM, and signed releases.
- External penetration test before handling real funds.
- Smart-contract audit for any proprietary contracts.
- Recovery tabletop exercise before production.
- Clear customer recovery and incident playbooks.

### AI security boundary

- AI reads from a redacted, permission-filtered tool layer.
- AI never sees complete keys, secrets, raw KYC documents, or unrestricted provider credentials.
- AI may draft an intent but cannot bypass deterministic validation.
- Material actions require the same authorization path whether initiated by UI or AI.
- High-risk customer communications and compliance decisions require human/provider review.

---

## 9. Design system: modern Swiss private bank

### Desired character

- Quiet confidence.
- Precision and legibility.
- Generous space.
- Institutional without bureaucracy.
- Warm enough to feel personal.
- Digital-native without “crypto” visual clichés.

Avoid neon gradients, glowing coins, token logos as decoration, animated price theatrics, casino-green profit treatments, or excessive glassmorphism.

### Typography

Production preference, subject to licensing:

- **Primary sans:** Suisse Int’l or Neue Haas Grotesk.
- **Open-source build default:** Inter Variable.
- **Editorial/display serif:** Source Serif 4.
- **Tabular/technical:** IBM Plex Mono.

Rules:

- Use the sans for navigation, controls, balances, and body copy.
- Use the serif sparingly for brand statements, reports, and editorial education.
- Use tabular numerals for all money, rates, and transaction tables.
- Never communicate state using color alone.
- Default body size: 16px; dense financial tables may use 13–14px with strong contrast.

### Color system

| Token | Hex | Use |
|---|---|---|
| `ink-950` | `#0B1720` | Primary text, dark surfaces |
| `ink-800` | `#20313B` | Secondary headings |
| `alpine-800` | `#163B32` | Brand anchor, trusted actions |
| `alpine-600` | `#2E6254` | Links, selected states |
| `stone-50` | `#FAF9F6` | Main background |
| `stone-100` | `#F2F0EA` | Secondary background |
| `stone-300` | `#D8D3C8` | Borders and dividers |
| `brass-500` | `#9B7847` | Premium accent, used sparingly |
| `blue-600` | `#2F5E75` | Informational state |
| `amber-600` | `#A76521` | Warning/risk attention |
| `red-700` | `#8C3434` | Critical/destructive state |
| `green-700` | `#246247` | Confirmed/safe state, not profit decoration |

Dark mode should use ink surfaces and warm off-white text, not pure black. Brass is never used for primary body text.

### Spacing and layout

- 4px base spacing unit.
- Main steps: 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Maximum application content width: 1440px.
- Reading/documentation width: 720–800px.
- Desktop page gutters: 32–48px.
- Mobile gutters: 16–20px.
- Card padding: 20–24px.
- Border radius: 6px controls, 10px cards, 14px exceptional hero surfaces.
- Minimal shadows; rely on borders, tone, and spacing.
- Persistent left navigation on desktop; bottom navigation reserved for eventual mobile app.

### Information hierarchy

1. Available/spendable money.
2. Total relationship value.
3. Material risk or required action.
4. Recent activity.
5. Allocation and performance.
6. Membership and benefits.

Risk and legal status must be adjacent to the affected asset or action, not buried in a generic footer.

### Core components

- App shell and secure-session header.
- Money amount with privacy toggle.
- Asset row and allocation bar.
- Account/wallet selector.
- Transaction timeline.
- Risk label and disclosure drawer.
- Yield strategy card.
- Transfer composer and confirmation sheet.
- Policy builder.
- Approval request.
- Membership progress card.
- Benefit entitlement card.
- Concierge thread with action-intent preview.
- Empty, pending, restricted, failed, and degraded-service states.

### Motion

- 120–180ms for control feedback.
- 200–280ms for panels and route continuity.
- No motion for its own sake.
- Respect reduced-motion settings.
- Money-state changes use restrained transition and a durable textual status.

### Accessibility

- WCAG 2.2 AA target.
- Full keyboard navigation.
- Visible focus styles.
- Screen-reader descriptions for charts and transaction state.
- Color-independent status.
- Locale-aware currency/date formatting.
- Plain-language risk explanations.

---

## 10. Demonstration product before Bridge onboarding

The first deployed product should be functionally real on the Privy/onchain side and simulated only where Bridge approval is required.

### What must be real

- Marketing site and documentation.
- Privy authentication.
- Passkey-ready onboarding.
- Privy embedded testnet wallet.
- Receive/send approved testnet assets.
- Connect external wallet read-only.
- Portfolio and transaction views.
- One sandbox/testnet Earn flow.
- Policy controls and transaction confirmation.
- Membership calculation using test data.
- Risk/disclosure surfaces.
- Support/concierge interface with deterministic, read-only tools.

### What may be simulated behind provider interfaces

- Bridge KYC states.
- Fiat virtual-account provisioning.
- ACH/wire funding lifecycle.
- Card issuance and transactions.
- Rewards settlement.
- Travel benefits enrollment.

Simulated features must be labeled “Sandbox” or “Demonstration.” Do not create a deceptive impression that production rails are active.

### Bridge-facing demo story

1. A user signs up with a passkey.
2. Privy creates a noncustodial wallet.
3. The user sees custody and recovery explained clearly.
4. The user completes a simulated Bridge KYC flow.
5. Sandbox USD account details appear.
6. A simulated ACH deposit becomes test USDC.
7. The user allocates part of USDC to a test yield strategy.
8. The risk dashboard shows liquidity and protocol exposure.
9. A sandbox card purchase draws from the spending pocket.
10. The user sets a policy to maintain a minimum spendable reserve.
11. The documentation site shows provider roles, geography controls, and incident processes.

This demonstrates product quality, clear flow of funds, responsible disclosures, technical competence, and operational seriousness—the evidence most useful in Bridge program underwriting.

---

## 11. Delivery roadmap

### Phase 0 — foundation and decisions (1–2 weeks)

- Approve brand working name and positioning.
- Freeze MVP scope.
- Confirm target launch region assumption.
- Create Privy sandbox application.
- Validate desired Privy custody configuration and export/recovery behavior.
- Establish monorepo, CI, environments, design tokens, and threat model.
- Create provider interfaces and simulators.
- Draft product disclosures and provider-role diagrams.

Exit criteria:

- Architecture decision records approved.
- No unresolved ambiguity over wallet control.
- Product scope small enough for one coherent demo.

### Phase 1 — secure wallet and portfolio demo (3–4 weeks)

- Marketing/app shell and design system.
- Privy login and wallet provisioning.
- Device/session management.
- Testnet receive/send.
- External wallet connection.
- Portfolio normalization.
- Transaction history.
- Risk labels and disclosure components.
- Documentation site.
- Storybook and automated accessibility baseline.

Exit criteria:

- User can onboard and complete testnet wallet journeys.
- No secret leakage or critical automated security findings.
- Core screens meet design and accessibility bar.

### Phase 2 — Earn, policies, and membership (3–4 weeks)

- One curated sandbox/testnet strategy.
- Deposit/withdraw lifecycle.
- Risk/exposure dashboard.
- Spending-reserve policy in recommendation mode.
- Membership qualification engine.
- Benefits entitlement framework.
- AI concierge with read-only portfolio and documentation tools.

Exit criteria:

- All state transitions recover from retries and refreshes.
- Strategy state reconciles against chain data.
- AI cannot initiate unauthorized actions.

### Phase 3 — Bridge-ready simulated financial product (2–3 weeks)

- Simulated Bridge verification.
- Simulated virtual account and funding lifecycle.
- Simulated card lifecycle and transaction states.
- Provider webhook test harness.
- Provider-source reconciliation and projection-health UI.
- Operations console for review, restrictions, and support.
- Partner diligence package and recorded end-to-end demonstration.

Exit criteria:

- Demo deploy is stable and clearly labeled.
- Funds-flow and responsibility matrix complete.
- Bridge application materials ready.

### Phase 4 — Bridge sandbox integration (timing depends on access)

- Bridge platform KYB/program review.
- Configure Bridge through Privy or direct provider adapter as agreed.
- Real sandbox KYC/KYB.
- Sandbox virtual accounts and transfers.
- Sandbox card flow where entitled.
- Webhook signatures, retries, and replay.
- Country/product matrix enforcement.
- Reconciliation against Bridge objects and reports.

Exit criteria:

- Complete sandbox evidence pack.
- No unexplained reconciliation differences.
- Signed commercial and responsibility matrix suitable for production planning.

### Phase 5 — controlled production (partner-dependent)

- External security assessment.
- Production infrastructure and access review.
- Approved disclosures, support, dispute, incident, and complaint procedures.
- Production KYC/card/rails enablement.
- Staff/founder alpha, then 25–50 invited customers.
- Limits and manual review for initial cohorts.
- Daily reconciliation and weekly partner/risk review.

### Phase 6 — premium benefits and mobile

- Merchant-funded rewards.
- Lounge and eSIM benefits.
- Insurance and concierge after commercial validation.
- React Native or native mobile application reusing domain/API contracts and design tokens.
- Mobile wallet provisioning, biometrics, push notifications, and secure-device storage.

---

## 12. Testing and quality gates

### Automated testing

- Unit tests for money types, qualification rules, and policy evaluation.
- Property-based tests for money display, qualification, and projection invariants.
- Integration tests against provider simulators.
- Contract tests against sandbox schemas.
- End-to-end tests for onboarding, transfer, Earn, card, restriction, and recovery flows.
- Replay tests for duplicate/out-of-order webhooks.
- Chaos tests for timeouts and partial provider failures.
- Accessibility tests.
- Visual regression tests for core design-system components.

### Financial and projection invariants

- No Aurel database record can create or mutate an authoritative customer balance.
- Every displayed balance or position has a provider/chain source, external identifier, status, and observation time.
- Deleting all projections and replaying authoritative sources yields the same normalized customer view, subject to source freshness.
- Provider event processed at most once, even when delivered repeatedly.
- Available amount comes directly from an authoritative provider or an explicitly labeled on-chain calculation.
- A failed transaction cannot remain represented as settled.
- Reconciliation differences are explicit, aged, assigned, and auditable.
- Displayed yield never combines principal movement with earned return.
- Fees are visible before confirmation where determinable.

### Launch gates

- External penetration test has no unresolved critical/high findings.
- Recovery and incident tabletop completed.
- Every material provider failure has a user-visible state and operational playbook.
- Country and product gating is enforced server-side.
- Provider refresh/reconciliation is deterministic and reports stale or missing authoritative sources.
- All regulated copy and marketing are approved by the responsible partner.
- No real funds are accepted through a feature marked sandbox/demo.

---

## 13. Operations and lean-team model

The product can be built by one highly leveraged technical founder, but production financial operations cannot be treated as unattended software.

### Founder-owned at pilot

- Product and engineering.
- Vendor coordination.
- Security and incident ownership.
- Provider/compliance-request routing.
- Customer escalation.
- Reconciliation review.

### Outsource initially

- Regulatory counsel and program contracts.
- Penetration testing.
- Privacy review.
- Bookkeeping/tax.
- On-call specialist support for serious incidents.
- Benefit and insurance administration through vendors.

### AI-assisted, not AI-authorized

- Draft support replies and investigations.
- Summarize provider requests.
- Prepare reconciliation explanations.
- Generate reports and documentation.
- Monitor exceptions and create cases.

Do not delegate final compliance decisions, irreversible money movement, incident declarations, or high-risk account recovery solely to an AI agent.

---

## 14. Economics and instrumentation

### Revenue streams

1. Membership subscription.
2. Net interchange share.
3. Fiat/stablecoin conversion and payment economics.
4. Transparent share of eligible yield economics where permitted.
5. Merchant-funded reward commissions.
6. Later: borrowing integration, tokenized-asset execution, qualified custody referrals, or advisory services only where permitted.

### Cost controls

- Reward budget derived from realized contribution margin.
- Benefits provisioned only while entitlement is active.
- Limit physical premium cards until retention is demonstrated.
- Prefer merchant-funded rewards over platform-funded cashback.
- Measure support and exception cost by feature and cohort.
- Do not subsidize high-volume transfers without a corresponding revenue path.

### Core metrics

- Signup → wallet activation.
- Wallet activation → KYC start/approval.
- KYC approval → first funding.
- First funding → card activation.
- 30/90-day funded retention.
- Average and median relationship balance.
- Productive-balance adoption and retention.
- Card spend and interchange contribution.
- Net revenue and contribution margin per active customer.
- Support cases and provider exceptions per 100 active customers.
- Fraud/dispute losses.
- Reconciliation breaks and resolution age.
- Percentage of users with passkeys and address allowlists.
- Concentration by chain, asset, protocol, and provider.

---

## 15. Open decisions before implementation

1. Working brand name and domain.
2. First launch geography and residency profile.
3. Consumer only or consumer plus sole-proprietor/business demo.
4. Privy embedded-wallet custody and recovery configuration.
5. Initial chain: recommend one EVM chain, likely Base or Ethereum L2, before multichain expansion.
6. Initial stablecoin: recommend USDC first.
7. Initial Earn protocol/strategy.
8. Whether connected external assets affect status or only portfolio visibility.
9. Membership prices and benefit budget.
10. Bridge Starter card eligibility and exact production pricing.
11. Whether Privy managed card components or direct Bridge APIs are preferred.
12. Rain fallback trigger.
13. Corporate domicile and initial legal/compliance opinion scope.
14. Tokenized-asset jurisdictions and exact initial instruments.
15. Production cloud/data-residency requirements.

---

## 16. Bridge diligence package

Prepare before requesting production enablement:

- Corporate ownership and funding information.
- Product narrative and target customer.
- Supported-country proposal.
- Complete flow-of-funds diagram.
- Wallet custody/control description.
- Asset, chain, and protocol allowlist.
- Screenshots/recording of onboarding, risk, and transaction flows.
- KYC and endorsement-state UX.
- Fraud, account-takeover, sanctions, wallet-risk, support, and incident controls.
- Data architecture and security summary.
- Expected users, transaction sizes, volume, and balances.
- Customer support and complaint process.
- Marketing copy and provider disclosures.
- Card funding and settlement design.
- Business continuity and key-person mitigation.

Questions to resolve:

1. Does Starter include live orchestration, virtual accounts, and consumer onboarding with no monthly minimum?
2. Are cards included or separately contracted?
3. Which card countries, networks, card types, and wallet-funding models are available?
4. What are KYC, transfer, conversion, FX, card, dispute, and support fees?
5. What reserves or prefunding apply?
6. What interchange share is available?
7. Which responsibilities remain with the application for AML, wallet monitoring, fraud, complaints, and reporting?
8. Which DeFi assets/protocols or customer flows are prohibited?
9. Can the program support the proposed noncustodial card allowance safely?
10. What volume thresholds move the account from Starter to contracted pricing?
11. What are termination, migration, and customer-data portability rights?
12. Which marketing terms—account, bank, cash, yield, private, deposit—are approved?

---

## 17. Recommended first implementation backlog

### Foundation

- [ ] Initialize monorepo and CI.
- [ ] Add code ownership, branch protection, dependency scanning, and secret scanning.
- [ ] Establish environment validation and secret boundaries.
- [ ] Create ADRs for wallet custody, chain, stablecoin, database, workflow engine, and deployment.

### Design system

- [ ] Implement design tokens.
- [ ] Load open-source fonts for prototype; document licensed-font upgrade.
- [ ] Build buttons, inputs, amount display, navigation, cards, tables, dialogs, status, risk, and disclosure components.
- [ ] Create Storybook with accessibility tests.
- [ ] Build responsive app shell and documentation layout.

### Privy

- [ ] Create Privy sandbox application.
- [ ] Implement login and wallet provisioning.
- [ ] Add passkey and step-up flows.
- [ ] Implement session/device view.
- [ ] Add testnet funding, receive, send, and transaction history.
- [ ] Document export/recovery behavior.

### Portfolio and risk

- [ ] Normalize assets, balances, transactions, and positions.
- [ ] Add external read-only wallet connection.
- [ ] Build liquidity and exposure calculations.
- [ ] Build asset/protocol risk cards.
- [ ] Add price-source fallbacks and stale-data warnings.

### Earn and policies

- [ ] Select one sandbox/testnet strategy.
- [ ] Implement quote, consent, deposit, pending, settled, withdrawal, and failure states.
- [ ] Build policy evaluation engine.
- [ ] Add spending reserve recommendation.
- [ ] Add deterministic pre-transaction checks.

### Bridge simulator and projections

- [ ] Create normalized Bridge adapter contract.
- [ ] Build KYC/endorsement simulator.
- [ ] Build virtual-account and transfer simulator.
- [ ] Build card simulator.
- [ ] Implement rebuildable provider/on-chain projections with source provenance.
- [ ] Build webhook receipt, signature verification, deduplication, replay, and source reconciliation.
- [ ] Build operations console.

### Membership and benefits

- [ ] Implement subscription/balance/activity qualification.
- [ ] Implement time-weighted qualification windows.
- [ ] Build entitlement service independent of vendors.
- [ ] Add simulated rewards/lounge/eSIM entitlements.

### Documentation and demo

- [ ] Publish custody and provider-role explanations.
- [ ] Publish security and risk methodology.
- [ ] Publish sandbox disclosures.
- [ ] Create Bridge diligence package.
- [ ] Record the end-to-end partner demo.

---

## 18. Primary sources and vendor references

### Core infrastructure

- [Privy pricing](https://www.privy.io/pricing)
- [Privy cards](https://docs.privy.io/financial-flows/cards/overview)
- [Privy fiat deposits](https://docs.privy.io/financial-flows/deposits/overview)
- [Privy fiat-deposit setup and verification](https://docs.privy.io/wallets/funding/fiat-deposits/setup)
- [Privy user wallets](https://docs.privy.io/wallets/overview/solutions/user-wallets)
- [Bridge platform](https://www.bridge.xyz/)
- [Bridge API documentation](https://apidocs.bridge.xyz/)
- [Rain platform](https://www.rain.xyz/)
- [Rain program launch model](https://www.rain.xyz/resources/launch-a-card-program-with-rain)
- [Rain premium global card programs](https://www.rain.xyz/solutions/premium-cards-for-global-spenders)

### Benefits

- [Kard developer documentation](https://www.getkard.com/docs/quickstart)
- [Fidel API documentation](https://docs.fidelapi.com/)
- [DragonPass API](https://apifox.dragonpass.com/apidoc/docs-site/6000000/338379m0)
- [Cover Genius / XCover API](https://xcover-api-docs.covergenius.com/)
- [1GLOBAL Connect API](https://docs.connect.1global.com/static/connect_v1.html)
- [Ten Lifestyle Group](https://tenlifestylegroup.com/faqs/)

### Competitive reference

- [Ether.fi membership levels](https://help.ether.fi/en/articles/303625-how-do-membership-levels-work)
- [Revolut paid-plan structure](https://www.revolut.com/en-DE/legal/paid-plans/)

---

## 19. Final recommendation

Proceed with a deployed, sandbox-only **Privy-first demonstration** before entering full Bridge program onboarding.

The demo should prove:

- premium institutional design;
- simple noncustodial onboarding;
- a genuinely functional wallet;
- understandable risk and custody disclosures;
- one curated Earn flow;
- a coherent membership model;
- simulated fiat/card flows through replaceable provider adapters;
- deterministic policies, source provenance, audit receipts, and reconciliation; and
- a credible path to controlled production.

Do not attempt to demonstrate every eventual feature. A secure, coherent receive–earn–spend experience is more persuasive to customers and partners than a wide collection of unfinished integrations.

The immediate build sequence is:

```text
Design system → Privy wallet → Portfolio/risk → Earn → Policies/membership
→ Bridge simulator → Projections/reconciliation → Partner demo → Bridge sandbox
```

This sequence preserves the core differentiation: independent architecture, visible safety, and a premium experience that earns customer trust gradually rather than demanding it through a large initial deposit.
