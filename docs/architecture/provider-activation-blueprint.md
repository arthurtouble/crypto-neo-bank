---
title: Provider activation blueprint
description: Concrete provider activation sequence, controls, and evidence requirements.
---

Internal handoff for turning Aura's prepared product surfaces into contracted services. Product UI stays provider-neutral; adapters, operations, and contracts name the provider.

## Operating rule

Aura stores provider references, projections, preferences, and support metadata, never the authority for balances, account details, transfer settlement, card status, or securities ([architecture](architecture.md)). Every adapter must support fresh reads, signed webhooks, idempotent commands, and reconciliation against its source.

Preview mode may show complete workflows and eligibility gates, never fabricated account numbers, cards, or completed transfers.

## Proposed providers

| Capability | Primary candidate | Alternate | Prepared product surface | Activation dependency |
| --- | --- | --- | --- | --- |
| USD accounts, ACH, wire, FedNow, on/off-ramp | Bridge | Noah, subject to country and product scope | Transfers, account details, recipients, transfer review | Platform approval, customer mapping, KYC link, API key, webhooks |
| Wallet login and signing | Privy | — | Aura account, receive, send, recovery, export | Already integrated; production configuration and monitoring |
| Cross-network USDC | LI.FI | Socket or provider-native routing when contracted | Exchange with automatic source selection | LI.FI integrated; Socket needs production access, adapter work, route monitoring, and supported-pair policy |
| Card issuing | Bridge through Stripe Issuing, subject to program approval (built against fakes) | — (Rain dropped) | Virtual Visa card, spending allowance on Base, freeze and daily limit, card details in Stripe's frames, phone wallets, disputes | Bridge card program approval, Stripe account and webhook, `BRIDGE_CARDS_SPENDER`, Stripe preview access for phone wallets, a real card on dev |
| Tag card payments | Acquiring or payment-link provider | — | Public Aura tag payment page | Merchant approval, hosted payment link, refunds, disputes, webhooks |
| Tokenized stocks and metals | Coinbase tokenized stocks on Base and Tether Gold, bought through LI.FI routes in Swap | — | Swap, with Chainlink reference prices | Country and eligibility rules for Coinbase stocks, issuer redemption records |

## Bridge activation

### Customer and compliance

1. Create or link a Bridge customer only after Aura has collected the minimum permitted onboarding data and terms acceptance.
2. Store the Bridge customer ID against the Privy subject; never infer identity from an email alone.
3. Launch the provider-hosted verification flow.
4. Read missing requirements and requests for information. Show only the next customer action.
5. Enable banking and card actions only once that capability is approved, not because a customer object exists.

### Virtual account

- Create a USD virtual account with an explicit destination configuration. Sync reusable ACH/wire instructions from Bridge, masked outside the authenticated detail view.
- Incoming-payment webhooks update Aura's projection; scheduled reconciliation re-reads the provider.
- The UI models `setup_required`, `pending`, and `active`. The read adapter is wired for `BRIDGE_MODE=live`: it needs a linked Bridge customer ID and API key, follows Bridge's customer virtual-account pagination, and returns only complete activated USD instructions. The mode doesn't enable outgoing transfers or webhooks. Verify the customer mapping, provider approval, and reconciliation before showing instructions.
- Bridge's [virtual-account API](https://apidocs.bridge.xyz/api-reference/virtual-accounts/list-virtual-accounts-by-customer) is the source of account status and instructions. Its older [card-provisioning API is deprecated](https://apidocs.bridge.xyz/api-reference/cards/provision-a-card-account); Aura's cards use Bridge's `cards` endorsement and Stripe Issuing instead ([partner integration](partner-integration.md#cards-bridge-and-stripe-issuing)).

### Transfers

Command path: validate customer capability → validate recipient → show amount, fee, timing, and funding source → check the customer's controls → submit with an idempotency key → store the provider transfer ID → update from webhooks → reconcile until terminal.

Never mark a transfer complete from the initial API response. Support returns, refunds, review holds, and requests for information.

### Liquidation and routing addresses

Provider-created liquidation addresses may accept configured assets and convert them to USD. They are not a universal deposit address. Show the exact asset and network the provider returns, and reject unsupported pairs.

## Rewards

Cut: no provider reports memberships or benefits. Card cashback may return as its own feature once cards are live, with a funded program and the provider's earning, reversal, and fulfilment references, showing only what the provider confirms.

## Configuration

Secrets go in Cloudflare secret bindings, never source control:

```text
BRIDGE_API_KEY
BRIDGE_WEBHOOK_PUBLIC_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
ACQUIRING_API_KEY
ACQUIRING_WEBHOOK_SECRET
```

Cards also need two plain variables, `STRIPE_PUBLISHABLE_KEY` and `BRIDGE_CARDS_SPENDER` ([partner integration](partner-integration.md#cloudflare-resources)). Each service also needs an explicit mode (`preview` or `live`), approved countries, timeout, retry ceiling, circuit breaker, and support owner. Live mode fails closed when credentials, mappings, or customer approval are missing.

## Go-live evidence

- Signed contract, pricing schedule, countries, prohibited uses, and termination/export terms.
- Sandbox happy path and failure fixtures.
- Authentication, secret rotation, webhook signature, replay, and idempotency tests.
- Support runbooks for pending, rejected, returned, disputed, expired, and provider-outage states.
- Reconciliation reports proving Aura projections converge to the provider.
- Legal review of product copy, fees, privacy, complaints, and disclosures.
- Production canary customer and kill switch for each capability.
