---
title: Provider projections
description: How provider events become read models for bank, card, and wallet-policy integrations.
---

## Flow

1. Each provider posts to its own endpoint, and the web Worker verifies that provider's signature scheme. The provider comes from the URL, never the payload. A provider whose secret is not set returns 503 `provider_not_connected`.
   - `POST /api/webhooks/bridge`: Bridge RSA signature. `X-Webhook-Signature: t=<ms>,v0=<base64>` over `<t>.<raw body>`, 10-minute tolerance, key in `BRIDGE_WEBHOOK_PUBLIC_KEY` (the PEM from Bridge's webhook endpoint).
   - `POST /api/webhooks/privy`: Svix (`svix-id`, `svix-timestamp`, `svix-signature`), 5-minute tolerance, secret in `PRIVY_WEBHOOK_SECRET` (`whsec_…`).
   - `POST /api/webhooks/stripe`: Stripe signature. `Stripe-Signature: t=<s>,v1=<hex>`, HMAC-SHA256 over `<t>.<raw body>`, 5-minute tolerance, secret in `STRIPE_WEBHOOK_SECRET` (`whsec_…`). Other schemes (such as test `v0`) are ignored.
2. The adapter normalizes the event, resolves the provider's customer to an Aura customer through `provider_customer_links`, records a `webhook_receipts` row (replay protection), and enqueues it. Bridge `customer` and `kyc_link` events become `provider.customer.updated`; other Bridge categories are recorded and acknowledged but not projected yet. Stripe events resolve the customer through `card_account_projections` (the card ID): `issuing_card.created` and `issuing_card.updated` become `card.account.updated`, and `issuing_authorization.created` becomes a card spend notice ("Card: $12.50 at Merchant" or "Card declined: …"). `issuing_authorization.created` and `issuing_transaction.created` (`card.transaction.created`) are also kept in `card_observations` for the operations app's money movement; a settled transaction replaces its hold. The queue consumer ignores both. Other Stripe events are recorded and acknowledged.
3. The events Worker (`apps/events`) applies it with `applyProviderEvent` from `packages/provider-projections`, then marks the receipt processed.
4. The web app reads the projection. Every projection keeps its source provider and observation time, and is rebuildable by replaying events.

A failure while applying is retried and ends in the dead-letter queue after five attempts. Events that have no projection, name an unknown customer, or fail validation are acknowledged and logged, not retried.

## Event contract

| Event type | Providers | Projection | Read by |
| --- | --- | --- | --- |
| `provider.customer.updated` | bridge | `provider_customer_links` | Bank account onboarding status |
| `bank.payout.updated` | bridge | `action_events` (`bank_payout`) | Payout status in Transactions |
| `card.account.updated` | stripe | `card_account_projections` | `GET /api/cards` while `payment_cards` is on (which card is the customer's; the card itself is read from Stripe) |
| `wallet.policy.updated` | privy | `wallet_policies` | `GET /api/security/policy` (`walletPolicies`) |

Payload schemas are strict (`cardAccountEventSchema`, `walletPolicyEventSchema`); unknown fields, including card numbers, are rejected. The former `membership.updated` and `benefit.entitlement.updated` events were removed with Rewards and are now ignored as unsupported.

## Ordering and integrity

- Card and wallet-policy rows only change when the event is newer than the stored observation.
- A card reference never moves to another customer or provider.
- Projections never authorize money movement. The issuer and wallet provider remain authoritative.

## Aura-owned tables in the same package

- `user_preferences`: notification choices (`GET`/`PATCH /api/preferences`), honored by `lib/notifications/deliver.ts`. Security notices are always sent.
- `notifications`: one row per notice (money received, an action completed or failed, a security change), unique per customer and event (`dedupe_key`), with per-channel delivery status. Recorded by `lib/notifications/store.ts`; the in-app list never depends on delivery.
- `push_subscriptions`: each browser's Web Push endpoint and keys (`PUT`/`DELETE /api/notifications/push`). Removed when the push service answers 404 or 410.
- `incoming_watches`: which accounts to check for money received, since when, and when last checked (`lib/notifications/incoming.ts`). Only transfers after `watched_since` notify; watching stops 30 days after the customer was last active.
- `command_idempotency`: `claimProviderCommand` and `settleProviderCommand` stop a retried request from sending the same provider command twice. Bank account commands use it. Card commands (create, controls, disputes) instead send Stripe an `Idempotency-Key` built from the request ID.

## Bridge commands

Bridge onboarding (KYC link), a USD virtual account that deposits to the customer's Aura account, and payouts run only when the `fiat_accounts` switch is on and `BRIDGE_API_KEY` is set. For a payout, Bridge returns a Base deposit address, and the customer funds it with an ordinary transfer [action](money-actions.md). Request and response shapes must be confirmed against Bridge's sandbox.
