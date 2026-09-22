# Aurel Product Parity Design

Date: 2026-09-22  
Status: Approved architecture; implementation in progress

## Purpose

Aurel should let a customer find and exchange any supported digital asset through a familiar search and review flow, understand the actual history of their portfolio, and use dependable daily account and DeFi tools. The interface should hide routing details until they affect a decision. The customer keeps control of wallet transactions. Bank, card, securities, rewards, and shared account execution only becomes live after the relevant provider and legal gates are satisfied.

The initial product already has Privy wallets, Base balances, LI.FI routed quotes for twelve curated assets, USDC cross network routes, Aave actions, a market list, a modeled chart, recipient controls, planning schedules, and provider ready banking and card surfaces. This design completes the remaining product independent of banking partners, then defines the exact activation boundaries for partner services.

## Shared authority and safety rules

1. Chain contracts and contracted providers are authoritative for balances, positions, settlement, entitlements, and regulated eligibility. Market data sources are authoritative only for their observed prices. D1 holds customer instructions, access controls, audit evidence, and rebuildable projections; it is never an account ledger.
2. A transaction follows: authenticated subject and owned wallet → current eligibility and feature flag → policy evaluation → prepared action validation → current quote → step up when required → simulation → explicit wallet or provider confirmation → independently verified settlement. An approval is a transaction and follows the same checks.
3. Prepared calls are bound immutably to the subject, wallet, chain, target, value, calldata hash, semantic action, quote or provider reference, and expiry. A submitted hash is attached only after its chain transaction matches that preparation. Receipt success alone cannot prove the customer approved the intended action; relevant effects or provider settlement records must match before the activity is marked complete.
4. Search visibility, ability to quote, permission to execute, and legal eligibility are distinct states. A provider token list never grants legal eligibility. A quote never proves an asset is safe, verified, or appropriate.
5. Missing identity, price, transaction, source history, issuer, document, or provider evidence fails closed or is clearly labeled unavailable. The interface does not invent values or backfill with modeled data without naming the model.
6. A server timer may create a reminder or due occurrence. It cannot sign or submit a customer wallet transaction. Automatic execution requires a separately approved, narrowly scoped and revocable provider or smart account mandate.
7. Invitation, recovery, passkey, address cooling, account lock, country controls, privacy, and incident kill switches apply to every new route.

## Delivery programs and order

### 1. Transaction evidence and execution safety

Repair intent status polling, which currently queries `type` instead of `intent_type`. Add immutable prepared transaction records and independently match submitted hashes to them. Confirm only after transaction, receipt, and expected effect verification; distinguish pending, partial, failed, replaced, and reorged states. Harden LI.FI quote validation, require policy and simulation before approval, recheck expiry after approval, enforce a fresh step up challenge when required, verify wallet ownership, and add a dedicated Swap kill switch. Semantically constrain Aave prepared calls to governed contracts, selectors, token amounts, and spender bounds. Existing completed projections must not be silently upgraded to this stronger evidence level; show their weaker provenance.

### 2. Searchable asset catalog and Swap

Keep LI.FI as the first routing provider. A provider neutral quote interface permits a later Socket or 0x comparison based on live route coverage, net output, reliability, and security. An Aurel owned searchable selector replaces native dropdowns. It searches name, symbol, and contract address across the live LI.FI supported token catalog. Canonical token identity is chain ID and lowercase address; native assets have explicit chain scoped IDs. Verified, popular, held, favorite, and recent assets are ranked without hiding the complete supported catalog. Contract import is a separate warned path. Denied assets are hidden; unverified assets require an explicit risk acknowledgement and tighter quote checks. A displayed asset is actionable only when the chosen pair has a validated live route.

The UI shows the customer's amount and receive minimum first. Network, fees, approval, slippage, price impact, and route appear in review when material. Cross network selection is automatic when a valid route exists and is explained before approval. Stale quotes, unsupported chains, ambiguous symbols, missing metadata, and route failures have truthful states. Markets links use canonical token identity rather than ticker alone.

An embedded LI.FI or Socket widget may be used only if it can yield a validated unsigned plan to Aurel's execution boundary before any approval or signature. Their default internal transaction engines are not substitutes for Aurel's policy and evidence checks.

### 3. Tokenized stocks and other regulated markets

The same search can display reviewed tokenized products, but regulated assets use a separate catalog and order path. The record includes issuer, legal instrument and holder rights, token contract, venue, liquidity, custody and redemption model, market data rights, approved countries and customer classes, current offering documents, and review expiry. Provider reported identity and eligibility must be fresh at discovery, quote, and order submission. A quoted token in LI.FI or a DEX pool is not sufficient to activate trading.

Build provider adapters for issuer metadata and a regulated quote or order source, beginning with xStocks documentation and an approved distributor or venue. Do not activate trading until partner onboarding and jurisdiction analysis are complete. UI may show a disabled market and its actual availability reason. It cannot present a buy button that only fails after wallet signing.

### 4. Historical portfolio and cost basis

Build a paginated event ingestion layer from onchain and provider sources. Every observation carries source ID, chain and block hash when relevant, finality, account, asset, raw units, event type, ingestion version, and completeness. Rebuildable D1 caches hold normalized events, daily quantities, independent price observations, and calculation versions. Preserve the distinction between transfers between owned accounts, contributions, withdrawals, swaps, rewards, fees, wrapped assets, liabilities, and position receipts.

Portfolio history uses actual historical quantities and observed prices. Show incomplete intervals as gaps, not fabricated line segments. Calculate net value and time weighted return only for intervals with complete source and pricing coverage. Cost basis and realized or unrealized gains are versioned derived tax support, not tax advice; unsupported classifications remain review required. Include current Aave supply and debt positions and separately identify linked external wallets. The existing chart that reprices today's holdings historically is retired once actual history is available.

### 5. DeFi positions, rewards, and Earn

Create protocol adapters for account discovery, position legs, debt, collateral, claimable rewards, activity, provenance, and read completeness. Aave is the first adapter; any next protocol requires independent security, contract, and risk review. Aggregate by wallet, chain, protocol, market, position, asset, and leg. Avoid double counting receipt tokens and underlying assets. Claims require an exact prepared plan, policy, simulation, explicit wallet confirmation, and verified claim events.

Earn strategies show their underlying protocols, assets, custody, expected rate source and observation time, fees, liquidity and withdrawal terms, and risk. Direct wallet positions remain customer directed. A managed or rebalanced strategy becomes live only through a governed vault or contracted provider with a scoped mandate, settlement records, revocation, and emergency exit. Aurel's server cannot quietly rebalance customer funds.

### 6. Alerts, recurring swaps, and conditional orders

Price alerts and recurring plans store customer instructions. A trigger creates a due occurrence and a fresh quote; the customer explicitly approves each wallet transaction. Limit and stop style orders use an approved order protocol or provider only where cancellation, expiry, partial fills, authorization scope, and settlement can be independently tracked. Until then, the product labels them alerts to review, not automatic orders. Each execution rechecks balance, country eligibility, security policy, quote, and slippage.

### 7. Daily account and provider activation

Unify bank and wallet recipients while preserving their distinct authorities. Create idempotent schedule occurrences with timezone and daylight saving behavior, reminder state, pause and cancellation races, and an explicit approval path. Link goals to typed, authoritative account or position references and read progress from the source at request time. Bank payments, salary routing, issuer card controls, provider statements, rewards, concierge fulfillment, insurance, and shared accounts remain setup required until their provider contracts return active capabilities. Provider mandates must record scope and version; D1 does not manufacture balances or provider success.

## Product experience

Use the existing Aurel design system, Satoshi body type, phthalo green `#123524`, light and dark themes, and responsive layouts. Core actions retain familiar labels: Add Money, Receive, Send, Swap, Withdraw, Earn, Borrow, Portfolio. Search results, review screens, receipts, loading and failure states, keyboard focus, reduced motion, and mobile use are acceptance criteria for every tranche. Show the user the choice and consequence; keep provider and network details in secondary disclosure unless they change the decision.

## Verification and release

Each program adds unit tests for its decisions, route and schema tests for failure boundaries, desktop and mobile flow checks, accessible keyboard paths, documentation, and production smoke checks. Real money actions are never used as QA. Migration tests prove that analytical projections can be rebuilt without losing durable controls, customer instructions, or audit records. Production activation is separately gated by provider credentials, signed contracts, legal review, country matrix, security review, operational runbook, and a rollback switch.

## Provider research and current constraints

- LI.FI supports same chain and cross chain quotes, an embeddable widget, Privy compatibility, and a live token catalog. The existing app already uses its REST quote API. <https://docs.li.fi/widget/overview>
- Socket has a React widget, token search, and same chain and cross chain routes, but the widget handles signing and execution internally. <https://docs.socket.tech/integrate/socket-widget>
- LI.FI's RWA terms put asset selection, jurisdiction, identity, disclosure, and licensing duties on the integrator. <https://li.fi/legal/rwa-supplemental-terms>
- xStocks documents issuer metadata, trading limits, and an RFQ interface for onboarded partners, with distribution restrictions. <https://docs.xstocks.fi/developers>

## Explicit limitations

The complete routable universe means assets returned by approved routing and screening sources on supported chains, subject to a current executable quote; it cannot mean every deployed token. Tokenized securities and managed Earn cannot become live solely through code. Any unsupported or unapproved feature remains visibly unavailable with an accurate reason.
