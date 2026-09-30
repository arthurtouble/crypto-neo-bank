---
title: Partner integration and activation
description: Technical and operational activation steps for identity, provider, and event integrations.
---

Implementation checklist for moving each provider from sandbox or fakes to an approved production program.

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
3. Map Privy user and wallet IDs to opaque Aurel references. Store no key material.
4. The customer signs every money movement in their own wallet; Aura never signs.
5. Map Privy webhook events (`/api/webhooks/privy`, Svix-verified) into the normalized provider-event envelope.
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
2. Keep Bridge customer and resource IDs as opaque references.
3. Leave identity documents and sensitive verification evidence with Bridge.
4. Require an explicit provider approval state before revealing bank or card details.
5. Verify Bridge events at `/api/webhooks/bridge` (RSA signature, public key in `BRIDGE_WEBHOOK_PUBLIC_KEY`) and normalize them before the Queue.
6. Refresh the affected Bridge object after every event; a webhook payload is never the final balance.
7. Test duplicates, reordered and delayed events, provider downtime, and rejected transfers.
8. Reconcile transfers and card states daily before production launch.

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

Secrets, with `wrangler secret put`: `BRIDGE_API_KEY`, `BRIDGE_WEBHOOK_PUBLIC_KEY` (the PEM from Bridge's webhook endpoint), `PRIVY_WEBHOOK_SECRET` (`whsec_…`), and for cards `STRIPE_SECRET_KEY` (`sk_…`) and `STRIPE_WEBHOOK_SECRET` (`whsec_…`). Cards also need two plain variables: `STRIPE_PUBLISHABLE_KEY` (`pk_…`) and `BRIDGE_CARDS_SPENDER` (Bridge's card contract on Base). A provider without its webhook secret returns 503 `provider_not_connected`. See [provider projections](provider-projections.md).

Production and sandbox use different provider programs, secrets, queues, and D1 databases. Never put secret values in a Wrangler file or shell history.

## Launch gates

- Provider agreements and responsibility matrix signed.
- Jurisdiction and product-language review complete.
- Wallet recovery and key-control claims verified.
- Webhook signature, replay, retry, and dead-letter tests passed.
- Provider/chain reconciliation passes from an empty Aurel database.
- Incident ownership and 24/7 provider escalation paths documented.
- Limits, disclosures, fees, and failure messages match approved program behavior.
- No UI state shows a provider action as settled before authoritative confirmation.
