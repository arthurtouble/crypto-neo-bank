---
title: Architecture
description: How the interface, account controls, wallet, chains, protocols, and providers fit together.
---

Aura is a thin layer that prepares, checks, and explains money movements. It does not try to become the ledger, custodian, bank, exchange, and benefits provider at once.

## The transaction path

Most financial actions follow the same path:

1. **You ask for it.** A send, swap, cross-chain move, Earn deposit or withdrawal, or investment.
2. **Aura prepares and checks it.** The server checks the feature, your account lock, limits, and recipient settings, then builds the exact transaction.
3. **Your wallet signs it.** Any approval and the action itself go out together, as one signature and one onchain operation.
4. **The chain settles it.** The network accepts or rejects the operation.
5. **Aura verifies the result.** Aura reads the chain itself. It marks the movement complete only when the operation matches what was prepared, is final, and shows the expected transfer or deposit. Cross-chain moves also need delivery on the other network.

Preparation is not settlement. A quote is not a transfer. A wallet prompt is not a signature. A submitted transaction is not necessarily final.

## Main components

### Product interface

The web application is the customer-facing workspace. It presents balances, money movements, safety controls, documentation, and support. A mobile application can later use the same provider and policy interfaces.

### Identity and wallet infrastructure

Privy supplies sign-in and the wallet. Each customer has a smart wallet on Base, controlled by their Privy sign-in. It holds funds, signs batched operations, and can have gas paid by Aura's sponsor. Protected APIs verify the Privy access token on the server and derive the customer identity from that verified token.

### Account controls

Aura checks your controls before it prepares a money movement: the account lock, an optional daily limit, saved-recipients-only mode, and the wait before new recipients.

These checks can refuse a movement inside Aura. They cannot stop a customer from using an exported key or another app.

### Public chains and protocols

Base is the home network. Supported chain RPC endpoints and protocol contracts supply balances, market state, positions, transaction receipts, and settlement. Earn uses Aave V3 on Base and Sky savings on Ethereum. LI.FI supplies routes for swaps and cross-chain moves between supported assets.

### Rebuildable product data

Cloudflare D1 stores product projections, security preferences, transaction evidence, support records, and provider-event state. These records make the experience faster and operations auditable. They are not the authoritative financial ledger.

### Event and operations layer

Cloudflare Queues handles accepted asynchronous provider events. Scheduled checks identify stuck money movements and event-processing problems. Structured Worker logs and traces support investigation.

## Why Cloudflare

The product and APIs run on Cloudflare Workers. Static assets are delivered from the same platform. D1 holds application records, and Queues decouples provider-event intake from processing.

This keeps the operating surface small. It does not remove the need for backups, access control, migration review, observability, vendor monitoring, and tested incident procedures.

## Provider abstraction

Provider-specific behavior sits behind explicit interfaces. The product should not assume that one wallet, route, card, or banking provider will be permanent.

An abstraction is useful only when it preserves meaningful differences. A bank transfer and an onchain transaction should not be forced into identical states if their cancellation, dispute, or finality rules differ. Shared concepts are normalized; material provider behavior remains visible.

## Failure philosophy

Aura fails closed when a required security or eligibility fact is missing. It should not prepare a tokenized-market action without current eligibility data, treat an unknown value as within a daily limit, or mark a routed transfer complete only because the source transaction succeeded.

When a dependency is unavailable, the product should show the affected feature as unavailable and leave unaffected areas usable. See [Sources of truth](/concepts/sources-of-truth/) for how Aura treats missing financial data.
