---
title: Provider projections
description: How provider events become read models before card, rewards, and wallet-policy integrations go live.
---

## Flow

1. A provider adapter (Bridge, Rain, Privy) sends a normalized event to `POST /api/webhooks/provider`, signed with `PROVIDER_WEBHOOK_SECRET`.
2. The web Worker verifies the signature, records a `webhook_receipts` row (replay protection), and enqueues the event.
3. The events Worker (`apps/events`) applies it with `applyProviderEvent` from `packages/provider-projections`, then marks the receipt processed.
4. The web app reads the projection. Every projection keeps its source provider and observation time, and is rebuildable by replaying events.

A failure while applying is retried and ends in the dead-letter queue after five attempts. Events that have no projection, name an unknown customer, or fail validation are acknowledged and logged, not retried.

## Event contract

| Event type | Providers | Projection | Read by |
| --- | --- | --- | --- |
| `card.account.updated` | bridge, rain | `card_account_projections` | `GET /api/cards` while `payment_cards` is on |
| `membership.updated` | bridge, rain | `membership_projections` | `GET /api/rewards` |
| `benefit.entitlement.updated` | bridge, rain | `benefit_entitlements` | `GET /api/rewards` |
| `wallet.policy.updated` | privy | `wallet_policies` | `GET /api/security/policy` (`walletPolicies`) |

The `demo` provider may send any of these for testing. Payload schemas are strict (`cardAccountEventSchema`, `membershipEventSchema`, `benefitEntitlementEventSchema`, `walletPolicyEventSchema`); unknown fields, including card numbers, are rejected.

## Ordering and integrity

- Card, membership, and wallet-policy rows only change when the event is newer than the stored observation.
- A card reference never moves to another customer or provider.
- Benefit consumption only increases, so a late event cannot hand a used benefit back.
- Projections never authorize money movement. The issuer, benefit provider, and wallet provider remain authoritative.

## Aura-owned tables in the same package

- `user_preferences`: notification choices (`GET`/`PATCH /api/preferences`). Saved now, honored once a delivery service is connected. Security notices are always sent.
- `command_idempotency`: `claimProviderCommand` and `settleProviderCommand` stop a retried request from sending the same provider command twice. Market orders use it; bank transfers and card issuance should use it when their providers connect.
