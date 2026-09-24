---
title: Product status
description: A clear list of what is live, in preview, and not available.
sidebar:
  order: 1
---

Use this page to separate working features from planned services. A screen, data model, or integration interface is not evidence that a provider-backed service is active.

## Status definitions

- **Available in development:** implemented on the current `workers.dev` preview, subject to dependency availability. This does not mean Aurel is open for financial services.
- **Preview:** foundations or interface exist, but no customer entitlement or completed external fulfilment is promised.
- **Unavailable:** customers cannot use the service.

## Available in development

- Privy sign-in and customer-controlled embedded wallets
- External EVM wallet connection
- Native ETH, USDC, and WETH balance reads on Base
- Aave V3 market and position reads
- Aave supply, withdraw, borrow, and repay position previews
- Security preferences, saved addresses, and account lock
- Activity records and independently checked effects for newly prepared transfers; older records remain marked unverified
- Turnstile-protected support intake
- Provider-event signature, queue, retry, and dead-letter foundations
- Scheduled checks for stale transaction and event evidence
- Read-only concierge boundaries and authenticated support cases
- Public dependency status and incident-history surface
- Private-beta invitation, cohort, geography, limit, feedback, and feature-control foundations

## Route discovery

- Searchable assets on Base, Ethereum, Arbitrum, Optimism, and Polygon
- LI.FI Swap quote metadata only when Aurel's reviewed-tool and target controls permit it
- Cross-chain USD Coin route discovery when LI.FI responds

A quote can expire. Swap and cross-chain execution are paused until the exact provider plan can pass Aurel's preparation and settlement checks. A source-chain confirmation does not by itself prove destination delivery.

## Preview only

- Approval-required Swap reminders and saved ETH/USD price-alert preferences are available in the development preview. Price-alert checking and delivery are not active.
- Base direct-transfer preparation exists, but customer submission is disabled pending release review.
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
| Authentication and wallets | Development preview | Privy login, embedded or external EVM wallet, recovery/export path, customer confirmation |
| Base portfolio | Development preview | Native ETH, USDC, and WETH reads; provider and chain availability still apply |
| Base direct transfers | Disabled | Preparation and evidence checks exist; customer submission remains off pending review and server-verifiable step-up |
| Aave V3 | Read-only | Base market and position reads; new customer-signed actions paused pending an audited execution plan |
| Swap | Quote preview only | Search and validated route metadata; wallet review and execution are disabled |
| Cross-chain USDC | Quote preview only | LI.FI routes may be displayed, but customer-signed execution is disabled |
| Security and evidence | Development preview | Account lock, address book, cooling, limits, intent history, prepared-call checks; legacy receipt-only records stay unverified |
| Support | Development preview | Authenticated, rate-limited cases; response targets are not contractual SLAs |
| Membership | Preview | Tier projection and vendor-neutral entitlement model; no third-party fulfilment |
| Tokenized markets | Preview, access closed | Review and eligibility model exists; no trading access |
| Bank accounts and fiat rails | Unavailable | Requires contracted regulated provider and approved flows |
| Payment cards | Unavailable | Requires issuer/program approval, card controls, disputes, and country coverage |
| Insurance and travel benefits | Unavailable | Requires contracted vendors, eligibility, funding, claims, and support terms |
| Custom production domain and edge controls | Not configured | The current Worker is development-only |

## Dependency status

“Live” does not mean continuously available regardless of upstream systems. A network outage can stop settlement, an RPC problem can delay balance reads, Aave can pause a market, and LI.FI may return no safe route. Aurel should show that dependency state rather than substitute simulated data.

## What changes a status

A feature becomes live only when its technical path, security controls, operational ownership, terms, documentation, provider approval, and support route are complete. Marketing readiness alone does not change the label.

The current `workers.dev` app is a development preview, not Aurel's production financial-service origin. Financial execution remains disabled while independent review and operator launch work continue.

Last reviewed: 24 September 2026.
