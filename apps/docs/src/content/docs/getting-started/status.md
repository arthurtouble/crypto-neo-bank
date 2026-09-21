---
title: Product status
description: A clear list of what is live, in preview, and not available.
sidebar:
  order: 1
---

Use this page to separate working features from planned services. A screen, data model, or integration interface is not evidence that a provider-backed service is active.

## Status definitions

- **Live:** implemented and available in the current production deployment, subject to dependency availability.
- **Preview:** foundations or interface exist, but no customer entitlement or completed external fulfilment is promised.
- **Unavailable:** customers cannot use the service.

## Live on Base mainnet

- Privy sign-in and customer-controlled embedded wallets
- External EVM wallet connection
- Native ETH, USDC, and WETH balance reads on Base
- Supported direct transfers with policy checks and wallet confirmation
- Aave V3 market and position reads
- Aave supply, withdraw, borrow, and repay preparation
- Security preferences, saved addresses, and account lock
- Activity records and source-chain receipt checks
- Turnstile-protected support intake
- Provider-event signature, queue, retry, and dead-letter foundations
- Scheduled checks for stale transaction and event evidence
- Read-only concierge boundaries and authenticated support cases
- Public dependency status and incident-history surface
- Private-beta invitation, cohort, geography, limit, feedback, and feature-control foundations

## Available when providers respond

- Cross-chain USDC quotes and execution through LI.FI
- Routes on Base, Ethereum, Arbitrum, Optimism, and Polygon

A quote can expire. A source-chain confirmation does not by itself prove that the destination transfer is complete.

## Preview only

- Membership tier projections
- Travel, insurance, eSIM, concierge, and subscription benefit concepts
- Tokenized market eligibility framework
- Provider-neutral fiat, card, and benefit interfaces
- Operations processes that still need production staffing and external integrations

Preview items are not customer entitlements and may change.

## Not offered

Aurel does not currently offer bank accounts, fiat transfers, payment cards, insurance, securities trading, or regulated investment advice. These services remain unavailable until the right provider contracts, country approvals, controls, and disclosures are in place.

## Detailed matrix

| Capability | State | Current boundary |
| --- | --- | --- |
| Authentication and wallets | Live | Privy login, embedded or external EVM wallet, recovery/export path, customer confirmation |
| Base portfolio | Live | Native ETH, USDC, and WETH reads; provider and chain availability still apply |
| Base direct transfers | Live | Supported assets with product-policy evaluation and wallet signature |
| Aave V3 | Live | Base market and position reads plus customer-signed supply, withdraw, borrow, and repay plans |
| Cross-chain USDC | Live when quoted | LI.FI routes across five allowlisted EVM networks; destination delivery remains separate from source confirmation |
| Security and evidence | Live | Account lock, address book, cooling, limits, step-up, intent history, receipt checks |
| Support | Live | Authenticated, rate-limited cases; response targets are not contractual SLAs |
| Membership | Preview | Tier projection and vendor-neutral entitlement model; no third-party fulfilment |
| Tokenized markets | Preview, access closed | Review and eligibility model exists; no trading access |
| Bank accounts and fiat rails | Unavailable | Requires contracted regulated provider and approved flows |
| Payment cards | Unavailable | Requires issuer/program approval, card controls, disputes, and country coverage |
| Insurance and travel benefits | Unavailable | Requires contracted vendors, eligibility, funding, claims, and support terms |
| Custom production domain and edge controls | In progress | Worker deployment is live; broader launch controls still need completion |

## Dependency status

“Live” does not mean continuously available regardless of upstream systems. A network outage can stop settlement, an RPC problem can delay balance reads, Aave can pause a market, and LI.FI may return no safe route. Aurel should show that dependency state rather than substitute simulated data.

## What changes a status

A feature becomes live only when its technical path, security controls, operational ownership, terms, documentation, provider approval, and support route are complete. Marketing readiness alone does not change the label.

Last reviewed: 21 September 2026.
