---
title: Provider activation blueprint
description: Concrete provider activation sequence, controls, and evidence requirements.
---

This is the internal handoff for turning Aura's prepared product surfaces into contracted services. Product UI remains provider-neutral; adapters, operations, and contracts name the underlying provider.

## Operating rule

Aura stores provider references, projections, preferences, and support metadata. It does not treat its database as the authority for balances, account details, transfer settlement, card status, securities, or rewards. Every adapter must support fresh reads, signed webhooks, idempotent commands, and reconciliation against its source.

Preview mode may show complete workflows and eligibility gates, but never fabricated account numbers, cards, rewards, or completed transfers.

## Proposed providers

| Capability | Primary candidate | Alternate | Prepared product surface | Activation dependency |
| --- | --- | --- | --- | --- |
| USD accounts, ACH, wire, FedNow, on/off-ramp | Bridge | Rain or Noah, subject to country and product scope | Transfers, account details, recipients, transfer review | Platform approval, customer mapping, KYC link, API key, webhooks |
| Wallet login and signing | Privy | — | Aura account, receive, send, recovery, export | Already integrated; production configuration and monitoring |
| Cross-network USDC | LI.FI | Socket or provider-native routing when contracted | Exchange with automatic source selection | LI.FI integrated; Socket requires production access, adapter work, route monitoring, and supported-pair policy |
| Card issuing | Bridge through Stripe Issuing, subject to program approval | Rain | Card, controls, wallet provisioning | Issuer approval, cardholder KYC, program terms, disputes, auth webhooks |
| Merchant rewards | Kard | Card-network rewards provider | Offers, reward history, activation | Program agreement, customer enrolment, transaction-match webhook |
| Tag card payments | Acquiring or payment-link provider | — | Public Aura tag payment page | Merchant approval, hosted payment link, refunds, disputes, webhooks |
| Tokenized stocks and metals | Coinbase tokenized stocks on Base and Tether Gold, bought through LI.FI routes in Swap | — | Swap, with Chainlink reference prices | Country and eligibility rules for Coinbase stocks, issuer redemption records |

## Bridge activation

### Customer and compliance

1. Create or link a Bridge customer only after Aura has collected the minimum permitted onboarding data and terms acceptance.
2. Store the Bridge customer ID against the Privy subject; never infer customer identity from an email alone.
3. Launch the provider-hosted verification flow.
4. Read missing requirements and requests for information. Show only the next customer action.
5. Enable banking and card actions only after the applicable capability is approved—not merely because a general customer object exists.

### Virtual account

Create a USD virtual account with an explicit destination configuration. Sync reusable ACH/wire instructions from Bridge. Mask instructions outside the authenticated detail view. Incoming-payment webhooks update Aura's projection; scheduled reconciliation re-reads the provider.

The UI is modeled around `setup_required`, `pending`, and `active`. The read adapter is wired for `BRIDGE_MODE=live`: it requires a linked Bridge customer ID and API key, follows Bridge's customer virtual-account pagination, and returns only complete activated USD instructions. The mode does not enable outgoing transfers or webhooks. Verify the customer mapping, provider approval, and reconciliation before showing instructions.

Bridge's [virtual-account API](https://apidocs.bridge.xyz/api-reference/virtual-accounts/list-virtual-accounts-by-customer) is the source of account status and instructions. Its older standalone [card-provisioning API is deprecated](https://apidocs.bridge.xyz/api-reference/cards/provision-a-card-account); a card program must use the currently approved issuing path and its actual control APIs.

### Transfers

The command path is: validate customer capability → validate recipient → show amount, fee, timing, and funding source → check the customer's controls → submit with an idempotency key → store the provider transfer ID → update from webhooks → reconcile until terminal.

Never mark a transfer complete from the initial API response. Support returns, refunds, review holds, and additional-information requests.

### Liquidation and routing addresses

Provider-created liquidation addresses may accept configured assets and convert them to USD. They are not a universal deposit address. The app must display the exact asset and network returned by the provider and reject unsupported pairs.

## Benefits activation

Cashback and benefits require a funded program. Record the provider's entitlement, earning, reversal, and fulfilment references. Show a benefit only when the provider confirms eligibility and terms.

## Configuration

Production secrets belong in Cloudflare secret bindings, not source control:

```text
BRIDGE_API_KEY
BRIDGE_WEBHOOK_SECRET
REWARDS_API_KEY
REWARDS_WEBHOOK_SECRET
ACQUIRING_API_KEY
ACQUIRING_WEBHOOK_SECRET
```

Each service also needs an explicit mode (`preview` or `live`), approved countries, timeout, retry ceiling, circuit breaker, and support owner. Live mode must fail closed when credentials, mappings, or customer approval are missing.

## Go-live evidence

- Signed contract, pricing schedule, countries, prohibited uses, and termination/export terms.
- Sandbox happy path and failure fixtures.
- Authentication, secret rotation, webhook signature, replay, and idempotency tests.
- Customer support runbooks for pending, rejected, returned, disputed, expired, and provider-outage states.
- Reconciliation reports proving Aura projections converge to the provider.
- Legal review of product copy, fees, privacy, complaints, disclosures, and benefit terms.
- Production canary customer and kill switch for each capability.
