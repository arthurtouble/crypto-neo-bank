---
title: Provider projections
description: How provider events become read models for bank, card, and wallet-policy integrations.
---

## Flow

1. Each provider posts to its own endpoint, and the web Worker verifies that provider's signature. The provider comes from the URL, never the payload. A provider whose secret isn't set returns 503 `provider_not_connected`.
   - `POST /api/webhooks/bridge`: Bridge RSA. `X-Webhook-Signature: t=<ms>,v0=<base64>` over `<t>.<raw body>`, 10-minute tolerance, key in `BRIDGE_WEBHOOK_PUBLIC_KEY` (the PEM from Bridge's webhook endpoint).
   - `POST /api/webhooks/privy`: Svix (`svix-id`, `svix-timestamp`, `svix-signature`), 5-minute tolerance, secret in `PRIVY_WEBHOOK_SECRET` (`whsec_…`).
   - `POST /api/webhooks/stripe`: `Stripe-Signature: t=<s>,v1=<hex>`, HMAC-SHA256 over `<t>.<raw body>`, 5-minute tolerance, secret in `STRIPE_WEBHOOK_SECRET` (`whsec_…`). Other schemes (such as test `v0`) are ignored.
   - The body is read as a stream (`lib/http/body.ts`) and refused with 413 `payload_too_large` once it passes 128 KB (64 KB for `POST /api/webhooks/resend`), whatever `Content-Length` says.
2. The adapter normalizes the event, resolves the provider's customer to an Aura customer through `provider_customer_links`, records a `webhook_receipts` row (replay protection), and enqueues it.
   - A provider retry of an event already recorded is answered 200 `duplicate: true`. The exception is a receipt still `received` a minute after it was recorded, with the same payload hash: the event never reached the queue (the Worker stopped in between), so the retry takes the receipt over and queues it (`webhook.requeued`).
   - Bridge: `customer` and `kyc_link` events become `provider.customer.updated`; other categories are recorded and acknowledged, not projected yet. An event whose `event_created_at` can't be read is refused (400 `invalid_event`), since it can't be ordered against the stored projection.
   - Stripe: the customer is resolved through `card_account_projections` (the card ID). `issuing_card.created` and `issuing_card.updated` become `card.account.updated`. `issuing_authorization.created` becomes a card spend notice ("Card payment: $12.50 at Merchant" or "Card payment declined: …"). `issuing_authorization.created` and `issuing_transaction.created` (`card.transaction.created`) are also kept in `card_observations` for the operations app's money movement; a settled transaction replaces its hold, and the queue consumer ignores both. Other Stripe events are recorded and acknowledged.
3. The events Worker (`apps/events`) applies it with `applyProviderEvent` from `packages/provider-projections`, then marks the receipt processed.
4. The web app reads the projection. Every projection keeps its source provider and observation time and is rebuildable by replaying events.

A failure while applying is retried and goes to the dead-letter queue after five attempts. Events with no projection, an unknown customer, or failed validation are acknowledged and logged, not retried.

## Event contract

| Event type | Providers | Projection | Read by |
| --- | --- | --- | --- |
| `provider.customer.updated` | bridge | `provider_customer_links` | Bank account onboarding status |
| `bank.payout.updated` | bridge | `action_events` (`bank_payout`) | Payout status in Transactions |
| `card.account.updated` | stripe | `card_account_projections` | `GET /api/cards` while `payment_cards` is on (which card is the customer's; the card itself is read from Stripe) |
| `wallet.policy.updated` | privy | `wallet_policies` | `GET /api/security/policy` (`walletPolicies`) |

Payload schemas are strict (`cardAccountEventSchema`, `walletPolicyEventSchema`); unknown fields, including card numbers, are rejected. `membership.updated` and `benefit.entitlement.updated` were removed with Rewards and are ignored as unsupported.

## Ordering and integrity

- Card and wallet-policy rows change only when the event is newer than the stored observation.
- Stripe dates events to the second, so two card updates can share a timestamp. Then the more restrictive status wins (closed, frozen, restricted, active, pending, eligible) and an update with the same status is applied, so the result doesn't depend on arrival order (`cardObservationSupersedes`). The card reads from Stripe's API (`recordCard` in `lib/cards/service.ts`) follow the same rule and never change another customer's card.
- A card reference never moves to another customer or provider.
- Projections never authorize money movement. The issuer and wallet provider stay authoritative.

## Aura-owned tables in the same package

- `user_preferences`: notification choices (`GET`/`PATCH /api/preferences`), honored by `lib/notifications/deliver.ts`. Security notices are always sent.
- `notifications`: one row per notice (money received, an action completed or failed, a security change), unique per customer and event (`dedupe_key`), with per-channel delivery status. Recorded by `lib/notifications/store.ts`; the in-app list never depends on delivery. A delivery run (`lib/notifications/deliver.ts`) claims each notice before sending it: it counts the attempt and sets `delivery_claimed_until` two minutes ahead, so the cron and a request's background delivery never send a notice twice, and a claim left by a stopped run lapses. Each push request times out after 5 seconds, and a run stops starting notices after 25 seconds; the next run takes the rest. Delivered or failed notices are deleted after 180 days ([retention schedule](../operations/data-retention-schedule.md)). Links in emails and pushes are paths in the app only (`appPath`); anything else opens `/app`, and the service worker (`public/sw.js`) opens only pages on Aura's own origin.
- `push_subscriptions`: each browser's Web Push endpoint and keys (`PUT`/`DELETE /api/notifications/push`). Endpoints must be HTTPS on a known push service (`lib/notifications/push-endpoints.ts`: `fcm.googleapis.com`, `*.push.apple.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`); the end-to-end tests' fake push service on loopback HTTP is allowed only in local-edge test mode. A customer keeps at most 10 browsers; a new one replaces the one subscribed longest ago. An endpoint saved for another customer is never moved: `PUT` answers 409 `subscription_in_use`, and the app subscribes the browser again for a fresh endpoint. Removed when the push service answers 404 or 410. The data download lists each browser's endpoint, `created_at`, and `failures`, never its keys.
- `incoming_watches`: which accounts to check for money received, since when, and when last checked (`lib/notifications/incoming.ts`). Only transfers after `watched_since`, and in the last 90 days, notify, so a notice deleted by the retention cleanup (`lib/privacy/retention.ts`) never comes back; watching stops 30 days after the customer was last active.
- `command_idempotency`: `claimProviderCommand` and `settleProviderCommand` stop a retried request from sending the same provider command twice. Bank payouts use it: the same account, amount, and rail is claimed for the action's 10-minute signing window, so a retry gets the first action back instead of a second Bridge payout. Card commands (create, controls, disputes) instead send Stripe an `Idempotency-Key` built from the request ID.
- The package also holds the stuck-action thresholds (`STUCK_SUBMITTED_MS`, `STUCK_SETTLING_MS`), so the operations views and the events Worker's reconciliation agree on when an action is stuck.

## Bridge commands

Bridge onboarding (KYC link), a USD virtual account depositing to the customer's Aura account, and payouts run only when the `fiat_accounts` switch is on and `BRIDGE_API_KEY` is set. For a payout, Bridge returns a Base deposit address, and the customer funds it with an ordinary transfer [action](money-actions.md). Request and response shapes must be confirmed against Bridge's sandbox.
