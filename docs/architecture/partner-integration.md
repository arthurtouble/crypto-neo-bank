---
title: Partner integration and activation
description: Technical and operational activation steps for identity, provider, and event integrations.
---

Implementation checklist for moving each provider from sandbox or fakes to an approved production program. Product UI stays provider-neutral; adapters, operations, and contracts name the provider. Every adapter supports fresh reads, signed webhooks, idempotent commands, and reconciliation against its source, and fails closed when credentials, mappings, or customer approval are missing.

| Capability | Provider | Status |
| --- | --- | --- |
| Sign-in and wallet | Privy | Integrated; production app and monitoring pending |
| USD accounts, bank deposits and payouts | Bridge (Noah is the alternate, subject to country and product scope) | Built against a fake; waiting for approval |
| Cards | Bridge card program, issued through Stripe Issuing (Rain dropped) | Built against fakes; waiting for approval |
| Swaps and moves between networks | LI.FI | Integrated |
| Tokenized stocks and gold | Coinbase tokenized stocks on Base and Tether Gold, bought through LI.FI in Swap | Integrated; eligibility decision in [assets](assets.md#tokenized-stocks-and-metals) |
| Card payments on Aura tag pages | An acquiring or payment-link provider | Not chosen |

## Privy activation

### Information to obtain

- Sandbox app ID and allowed origins.
- Wallet ownership/export model.
- Supported login methods and passkey policy.
- Embedded-wallet chain configuration, starting with Base.
- Server-side authorization/signing requirements.
- Webhook signing secret (Svix `whsec_…`) and current event catalog.
- Recovery behavior and customer wording approved by Privy.

### Implementation sequence

1. Set `NEXT_PUBLIC_PRIVY_APP_ID` locally and in the Cloudflare environment.
2. Keep identity and wallet access behind their adapter interfaces.
3. Map Privy user and wallet IDs to opaque Aura references. Store no key material.
4. The customer signs every money movement in their own wallet; Aura never signs.
5. Map Privy webhook events (`/api/webhooks/privy`) into the normalized provider-event envelope.
6. Add sandbox contract tests for wallet creation, recovery, export, policy denial, and failed signing.
7. Complete a recovery exercise before accepting material deposits.

## Bridge activation

### Program decisions to obtain in writing

- Contracting entity and supported customer/entity types.
- Approved countries and explicit prohibited jurisdictions.
- KYC/KYB ownership, escalation, appeals, and ongoing monitoring.
- Fiat rails, account naming, settlement assets, conversion model, and limits.
- Card issuer, processor, geographies, funding model, disputes, chargebacks, and support allocation.
- Webhook signing scheme, retry policy, event IDs, and ordering guarantees.
- Reserve, prefunding, minimum-volume, pricing, and termination terms.
- Approved product language and required disclosures.

### Implementation sequence

1. Activate the compliance, fiat, and card adapters one at a time.
2. Create or link a Bridge customer only after Aura has the minimum onboarding data and the customer's terms acceptance. Store the Bridge customer ID against the Privy subject (`provider_customer_links`); never infer identity from an email alone. Keep Bridge IDs as opaque references.
3. Leave identity documents and sensitive verification evidence with Bridge. From missing requirements and requests for information, show the customer only their next action.
4. Enable banking and card actions only once that capability is approved, not because a customer object exists. Require an explicit approval state before revealing bank or card details.
5. Verify and normalize Bridge events before the Queue ([provider projections](provider-projections.md)).
6. Refresh the affected Bridge object after every event; a webhook payload is never the final balance.
7. Test duplicates, reordered and delayed events, provider downtime, and rejected transfers.
8. Reconcile transfers and card states daily before production launch.

### Accounts and transfers

- **Account details.** Bridge's [virtual-account API](https://apidocs.bridge.xyz/api-reference/virtual-accounts/list-virtual-accounts-by-customer) is the source of account status and instructions. Show only complete, activated USD instructions, masked outside the authenticated detail view. Incoming-payment webhooks update the projection; scheduled reconciliation re-reads Bridge.
- **Payouts.** Validate the customer's capability and the saved bank, show amount, fee, timing, and funding source, check the customer's controls, submit with an idempotency key, store the Bridge transfer ID, then update from webhooks and reconcile until terminal. Never mark a transfer complete from the first API response. Handle returns, refunds, review holds, and requests for information.
- **Liquidation addresses** may accept configured assets and convert them to USD. They are not a universal deposit address: show the exact asset and network Bridge returns, and reject other pairs.
- Bridge's older [card-provisioning API is deprecated](https://apidocs.bridge.xyz/api-reference/cards/provision-a-card-account); cards use the `cards` endorsement and Stripe Issuing (below).

### Bridge sandbox notes

From Bridge's documentation (apidocs.bridge.xyz), checked 25 September 2026:

- Sandbox base URL is `https://api.sandbox.bridge.xyz/v0`; sandbox keys start with `sk-test`. Set `BRIDGE_API_BASE_URL` to match.
- Sandbox customers must be created through the Customers API, not KYC links; approval is simulated with `POST /v0/customers/{id}/simulate_kyc_approval`. Aura's onboarding uses KYC links, so a sandbox run needs a test customer created by hand and linked in `provider_customer_links`.
- Sandbox fires no payment webhooks, and virtual accounts and transfers carry dummy data. Payout states (`bank.payout.updated`) can only be exercised in production.
- Every POST needs an `Idempotency-Key`; a reused key with a different body is rejected, and keys expire after 24 hours.
- Webhook endpoints start disabled; enable them with `PUT /webhooks` after creation.

## Cards: Bridge and Stripe Issuing

Rain was dropped. Cards run on Bridge's card program, issued through Stripe Issuing:

- **Approval.** Bridge approves a verified customer for cards (the `cards` endorsement on `GET /v0/customers/{id}`) and creates their Stripe cardholder (`stripe_cardholder_id`). The customer applies or re-confirms on a Bridge-hosted page from `GET /v0/customers/{id}/kyc_link?endorsement=cards`; the link is short-lived and never stored. Bridge KYC (on Deposit) comes first. Approval lasts 24 hours until a card is created.
- **Card.** One virtual Visa card per account: `POST /v1/issuing/cards` with a `crypto_wallet` on chain `base`, currency `usdc`, type `standard`, and the customer's Aura wallet as the address. Starts at a 500 USD daily limit, up to 10,000 USD. Stripe is the authority for the card, controls, authorizations, transactions, and disputes. D1 keeps which card is the customer's (`card_account_projections`, provider `stripe`) and, for the operations app, card payments as Stripe reported them (`card_observations`), which Stripe's history rebuilds.
- **Funding.** Nothing is prefunded. The customer signs a USDC `approve` on Base to `BRIDGE_CARDS_SPENDER` (an Aura money action, verified from the `Approval` log), and Bridge pulls each purchase just in time. A purchase is declined if the card is frozen, over its daily limit, or beyond the allowance or USDC balance.
- **Card details.** Only in Stripe.js Issuing Elements, with a 15-minute ephemeral key bound to the card and a browser nonce, after a fresh passkey confirmation. Aura never handles the card number.
- **Phone wallets.** Stripe's "Add to Wallet" button element is a private preview, live mode only. Behind `card_wallets`, untested with real wallets.
- **Disputes.** `POST /v1/issuing/disputes`, then `/submit`, once per settled transaction within 110 days. Credits return to the account's USDC on Base.
- **API version.** Pinned to `2026-03-25.preview`. Confirm with Bridge before going live.

Nothing has run against a real Bridge card program or Stripe account yet; the flow is tested against local fakes (`apps/web/tests/unit/cards.test.ts`, `apps/web/tests/e2e/cards.spec.ts`).

## Cloudflare resources

If the production resources don't exist yet:

```bash
pnpm --filter @aurel/web exec wrangler d1 create aurel-projections
pnpm --filter @aurel/web exec wrangler queues create aurel-provider-events
pnpm --filter @aurel/web exec wrangler queues create aurel-provider-events-dlq
```

Copy the D1 ID into both `apps/web/wrangler.jsonc` and `apps/events/wrangler.jsonc`, then apply and validate:

```bash
pnpm --filter @aurel/web exec wrangler d1 migrations apply aurel-projections --remote
pnpm typecheck:all
pnpm test
pnpm deploy:dry-run
```

Secrets, with `wrangler secret put`: `BRIDGE_API_KEY`, `BRIDGE_WEBHOOK_PUBLIC_KEY`, `PRIVY_WEBHOOK_SECRET`, and for cards `STRIPE_SECRET_KEY` (`sk_…`) and `STRIPE_WEBHOOK_SECRET`. Cards also need two plain variables: `STRIPE_PUBLISHABLE_KEY` (`pk_…`) and `BRIDGE_CARDS_SPENDER` (Bridge's card contract on Base). Webhook formats and the 503 `provider_not_connected` answer are in [provider projections](provider-projections.md). Each program also needs its approved countries, timeouts, retry ceiling, and support owner recorded.

Production and sandbox use different provider programs, secrets, queues, and D1 databases. Never put secret values in a Wrangler file or shell history.

## Launch gates

- Provider agreements and responsibility matrix signed.
- Jurisdiction and product-language review complete.
- Wallet recovery and key-control claims verified.
- Webhook signature, replay, retry, and dead-letter tests passed.
- Provider/chain reconciliation passes from an empty Aura database.
- Incident ownership and 24/7 provider escalation paths documented.
- Limits, disclosures, fees, and failure messages match approved program behavior.
- No UI state shows a provider action as settled before authoritative confirmation.
- Signed contract, pricing schedule, countries, prohibited uses, and termination and export terms.
- Sandbox happy path and failure fixtures; authentication, secret rotation, webhook signature, replay, and idempotency tests.
- Support runbooks for pending, rejected, returned, disputed, expired, and provider-outage states.
- Legal review of product copy, fees, privacy, complaints, and disclosures.
- A production canary customer and a tested feature switch for each capability.
