---
title: Architecture
description: How the interface, policy layer, wallet, chains, protocols, and providers fit together.
---

Aurel is built as a thin orchestration and policy layer. It does not try to become the ledger, custodian, bank, exchange, and benefits provider at once.

## The transaction path

Most financial actions follow the same path:

1. **The customer requests an action.** This may be a transfer, a protocol deposit, a repayment, or a cross-chain route.
2. **Aurel prepares and checks it.** The server validates the network, asset, destination, account controls, limits, required disclosures, and the proposed transaction data.
3. **The wallet presents the transaction.** The customer sees the final wallet request and chooses whether to sign.
4. **The chain or provider settles it.** The authoritative system accepts, rejects, or later updates the action.
5. **Aurel observes the result.** The product records the transaction reference, checks supported receipts, and presents the updated state.

Preparation is not settlement. A quote is not a transfer. A wallet prompt is not a signature. A submitted transaction is not necessarily final.

## Main components

### Product interface

The web application is the customer-facing workspace. It presents portfolios, transaction plans, safety controls, documentation, and support. A mobile application can later use the same provider and policy interfaces.

### Identity and wallet infrastructure

Privy supplies authentication and embedded-wallet infrastructure. Customers may also connect a supported external EVM wallet. Protected APIs verify the Privy access token on the server and derive the customer identity from that verified token.

### Policy layer

Aurel evaluates product controls before it prepares a supported action. Examples include account lock, allowlisted networks and assets, saved-destination rules, cooling periods, rolling limits, high-value review, and passkey step-up.

The policy layer can refuse to prepare an action inside Aurel. It cannot stop a customer from using an exported wallet or another application.

### Public chains and protocols

Base is the home network. Supported chain RPC endpoints and protocol contracts supply balances, market state, positions, transaction receipts, and settlement. Aave V3 on Base is the initial lending integration. LI.FI supplies route discovery for supported cross-chain USDC transfers.

### Rebuildable product data

Cloudflare D1 stores product projections, security preferences, transaction evidence, support records, and provider-event state. These records make the experience faster and operations auditable. They are not the authoritative financial ledger.

### Event and operations layer

Cloudflare Queues handles accepted asynchronous provider events. Scheduled checks identify stale transactions, expired reviews, and event-processing problems. Structured Worker logs and traces support investigation.

## Why Cloudflare

The product and APIs run on Cloudflare Workers. Static assets are delivered from the same platform. D1 holds application records, Queues decouples provider-event intake from processing, and Workers AI is available for bounded read-only assistance.

This keeps the operating surface small. It does not remove the need for backups, access control, migration review, observability, vendor monitoring, and tested incident procedures.

## Provider abstraction

Provider-specific behavior sits behind explicit interfaces. The product should not assume that one wallet, route, card, or banking provider will be permanent.

An abstraction is useful only when it preserves meaningful differences. A bank transfer and an onchain transaction should not be forced into identical states if their cancellation, dispute, or finality rules differ. Shared concepts are normalized; material provider behavior remains visible.

## Failure philosophy

Aurel fails closed when a required security or eligibility fact is missing. It should not prepare a tokenized-market action without current eligibility data, treat an unknown transaction value as below a step-up threshold, or mark a routed transfer complete only because the source transaction succeeded.

When a dependency is unavailable, the product should show the affected feature as unavailable and leave unaffected areas usable. See [Reliability and recovery](/operations/reliability-and-recovery/) for the operating model.

