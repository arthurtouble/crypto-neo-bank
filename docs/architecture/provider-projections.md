---
title: Provider projections
description: How provider events become read models before card, rewards, and wallet-policy integrations go live.
---

## Flow

1. Each provider posts to its own endpoint, and the web Worker verifies that provider's signature scheme. The provider comes from the URL, never the payload. A provider whose secret is not set returns 503 `provider_not_connected`.
   - `POST /api/webhooks/bridge`: Bridge RSA signature. `X-Webhook-Signature: t=<ms>,v0=<base64>` over `<t>.<raw body>`, 10-minute tolerance, key in `BRIDGE_WEBHOOK_PUBLIC_KEY` (the PEM from Bridge's webhook endpoint).
   - `POST /api/webhooks/privy`: Svix (`svix-id`, `svix-timestamp`, `svix-signature`), 5-minute tolerance, secret in `PRIVY_WEBHOOK_SECRET` (`whsec_…`).
   - `POST /api/webhooks/rain`: rejects everything until Rain's scheme is implemented. `RAIN_WEBHOOK_SECRET` is reserved.
2. The adapter normalizes the event, resolves the provider's customer to an Aura customer through `provider_customer_links`, records a `webhook_receipts` row (replay protection), and enqueues it. Bridge `customer` and `kyc_link` events become `provider.customer.updated`; other Bridge categories are recorded and acknowledged but not projected yet.
3. The events Worker (`apps/events`) applies it with `applyProviderEvent` from `packages/provider-projections`, then marks the receipt processed.
4. The web app reads the projection. Every projection keeps its source provider and observation time, and is rebuildable by replaying events.

A failure while applying is retried and ends in the dead-letter queue after five attempts. Events that have no projection, name an unknown customer, or fail validation are acknowledged and logged, not retried.

## Event contract

| Event type | Providers | Projection | Read by |
| --- | --- | --- | --- |
| `provider.customer.updated` | bridge, rain | `provider_customer_links` | Bank account onboarding status |
| `card.account.updated` | bridge, rain | `card_account_projections` | `GET /api/cards` while `payment_cards` is on |
| `membership.updated` | bridge, rain | `membership_projections` | `GET /api/rewards` |
| `benefit.entitlement.updated` | bridge, rain | `benefit_entitlements` | `GET /api/rewards` |
| `wallet.policy.updated` | privy | `wallet_policies` | `GET /api/security/policy` (`walletPolicies`) |

Payload schemas are strict (`cardAccountEventSchema`, `membershipEventSchema`, `benefitEntitlementEventSchema`, `walletPolicyEventSchema`); unknown fields, including card numbers, are rejected.

## Ordering and integrity

- Card, membership, and wallet-policy rows only change when the event is newer than the stored observation.
- A card reference never moves to another customer or provider.
- Benefit consumption only increases, so a late event cannot hand a used benefit back.
- Projections never authorize money movement. The issuer, benefit provider, and wallet provider remain authoritative.

## Aura-owned tables in the same package

- `user_preferences`: notification choices (`GET`/`PATCH /api/preferences`), honored by `lib/notifications/deliver.ts`. Security notices are always sent.
- `notifications`: one row per notice (money received, an action completed or failed, a security change), unique per customer and event (`dedupe_key`), with per-channel delivery status. Recorded by `lib/notifications/store.ts`; the in-app list never depends on delivery.
- `push_subscriptions`: each browser's Web Push endpoint and keys (`PUT`/`DELETE /api/notifications/push`). Removed when the push service answers 404 or 410.
- `incoming_watches`: which accounts to check for money received, since when, and when last checked (`lib/notifications/incoming.ts`). Only transfers after `watched_since` notify; watching stops 30 days after the customer was last active.
- `command_idempotency`: `claimProviderCommand` and `settleProviderCommand` stop a retried request from sending the same provider command twice. Bank account commands use it; card issuance should use it when Rain connects.

## Bridge commands

Bridge onboarding (KYC link), a USD virtual account that deposits to the customer's Aura account, and payouts run only when the `fiat_accounts` switch is on and `BRIDGE_API_KEY` is set. For a payout, Bridge returns a Base deposit address, and the customer funds it with an ordinary transfer [action](money-actions.md). Request and response shapes must be confirmed against Bridge's sandbox.
