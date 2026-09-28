---
title: Partner integration and activation
description: Technical and operational activation steps for identity, provider, and event integrations.
---

This is the implementation checklist for replacing Aurel’s deterministic provider simulators with approved sandbox and production programs.

## Current readiness

The application already defines stable boundaries for:

- identity and authenticated sessions;
- embedded and externally connected wallets;
- KYC/KYB state;
- fiat/stablecoin funding;
- card eligibility and status;
- onchain positions and allocation commands;
- signed provider events; and
- reconciliation against named authoritative sources.

The interactive `/app/sandbox` route exercises these boundaries without credentials. It is intended for partner reviews and failure-mode demonstrations.

## Privy activation

### Information to obtain

- Sandbox app ID and allowed origins.
- Selected wallet ownership/export model.
- Supported login methods and passkey policy.
- Embedded-wallet chain configuration, initially Base.
- Server-side authorization/signing requirements.
- Webhook signing secret (Svix `whsec_…`) and current event catalog.
- Recovery behavior and user-facing wording approved by Privy.

### Implementation sequence

1. Set `NEXT_PUBLIC_PRIVY_APP_ID` locally and in the Cloudflare environment.
2. Replace `DemoIdentityAdapter` behind the `IdentityAdapter` interface.
3. Replace `DemoWalletAdapter` behind the `WalletAdapter` interface.
4. Map Privy user and wallet IDs to opaque Aurel references. Do not store key material.
5. Have the customer sign every money movement in their own wallet; Aura never signs.
6. Map Privy webhook events (received at `/api/webhooks/privy`, Svix-verified) into the normalized provider-event envelope.
7. Add sandbox contract tests for wallet creation, recovery, export, policy denial, and failed signing.
8. Complete a recovery exercise before accepting material deposits.

## Bridge activation

### Program decisions to obtain in writing

- Contracting entity and supported customer/entity types.
- Approved countries and explicit prohibited jurisdictions.
- KYC/KYB ownership, escalation, appeals, and ongoing monitoring responsibilities.
- Available fiat rails, account naming, settlement assets, conversion model, and limits.
- Card issuer, processor, geographies, funding model, disputes, chargebacks, and support allocation.
- Webhook signing scheme, retry policy, event IDs, and ordering guarantees.
- Reserve, prefunding, minimum-volume, pricing, and termination provisions.
- Approved product language and required disclosures.

### Implementation sequence

1. Replace the compliance, fiat, and card demo adapters individually.
2. Keep Bridge customer IDs and resource IDs as opaque references.
3. Leave identity documents and sensitive verification evidence with Bridge.
4. Require an explicit provider approval state before revealing bank or card details.
5. Verify Bridge events at `/api/webhooks/bridge` (RSA signature, public key in `BRIDGE_WEBHOOK_PUBLIC_KEY`) and normalize them before the Queue boundary.
6. Refresh the affected Bridge object after every event; do not treat webhook payloads as the final balance.
7. Test duplicates, reordered events, delayed events, provider downtime, and rejected transfers.
8. Reconcile transfers and card states daily before production launch.

## Cloudflare resources

The repository contains placeholder D1 IDs so local development works without an account. Before remote deployment:

```bash
pnpm --filter @aurel/web exec wrangler d1 create aurel-projections
pnpm --filter @aurel/web exec wrangler queues create aurel-provider-events
pnpm --filter @aurel/web exec wrangler queues create aurel-provider-events-dlq
```

Copy the returned D1 ID into both `apps/web/wrangler.jsonc` and `apps/events/wrangler.jsonc`, then apply and validate:

```bash
pnpm --filter @aurel/web exec wrangler d1 migrations apply aurel-projections --remote
pnpm typecheck:all
pnpm test
pnpm deploy:dry-run
```

Set each connected provider's secrets with `wrangler secret put`: `BRIDGE_API_KEY` and `BRIDGE_WEBHOOK_PUBLIC_KEY` (the PEM from Bridge's webhook endpoint), `PRIVY_WEBHOOK_SECRET` (`whsec_…`), and for cards `STRIPE_SECRET_KEY` (`sk_…`) and `STRIPE_WEBHOOK_SECRET` (`whsec_…`). Cards also need two plain variables: `STRIPE_PUBLISHABLE_KEY` (`pk_…`) and `BRIDGE_CARDS_SPENDER` (Bridge's card contract on Base). A provider without its webhook secret returns 503 `provider_not_connected`. See [provider projections](provider-projections.md).

Production and sandbox must use different provider programs, secrets, queues, and D1 databases. Never place secret values in a Wrangler file or shell history.

## Launch gates

- Provider agreements and responsibility matrix signed.
- Jurisdiction and product-language review complete.
- Wallet recovery and key-control claims verified.
- Webhook signature, replay, retry, and dead-letter tests passed.
- Provider/chain reconciliation passes from an empty Aurel database.
- Incident ownership and 24/7 provider escalation paths documented.
- Limits, disclosures, fees, and failure messages match approved program behavior.
- No UI state represents a provider action as settled before authoritative confirmation.

## Bridge sandbox notes

From Bridge's documentation (apidocs.bridge.xyz), checked 25 September 2026:

- Sandbox base URL is `https://api.sandbox.bridge.xyz/v0`; sandbox keys start with `sk-test`. Set `BRIDGE_API_BASE_URL` accordingly.
- Sandbox customers must be created through the Customers API, not KYC links, and approval is simulated with `POST /v0/customers/{id}/simulate_kyc_approval`. Aura's onboarding uses KYC links, so a sandbox run needs a test customer created by hand and linked in `provider_customer_links`.
- Sandbox fires no payment webhooks, and virtual accounts and transfers carry dummy data. Payout states (`bank.payout.updated`) can only be exercised in production.
- Every POST needs an `Idempotency-Key`; a reused key with a different body is rejected, and keys expire after 24 hours.
- Webhook endpoints start disabled and must be enabled with `PUT /webhooks` after creation.

## Cards: Bridge and Stripe Issuing

Rain was dropped. Cards run on Bridge's card program, issued through Stripe Issuing:

- **Approval.** Bridge approves a verified customer for cards (the `cards` endorsement on `GET /v0/customers/{id}`) and creates their Stripe cardholder (`stripe_cardholder_id`). The customer applies or re-confirms on a Bridge-hosted page from `GET /v0/customers/{id}/kyc_link?endorsement=cards`; the link is short-lived and never stored. Bridge KYC (on Deposit) must come first. Approval lasts 24 hours until a card is created.
- **Card.** One virtual Visa card per account: `POST /v1/issuing/cards` with a `crypto_wallet` on chain `base`, currency `usdc`, type `standard`, and the customer's Aura wallet as the address. It starts at a 500 USD daily limit, up to 10,000 USD. Stripe is the authority for the card, its controls, authorizations, transactions, and disputes. D1 keeps only which card is the customer's (`card_account_projections`, provider `stripe`).
- **Funding.** Nothing is prefunded. The customer signs a USDC `approve` on Base to `BRIDGE_CARDS_SPENDER` (an Aura money action, verified from the `Approval` log), and Bridge pulls each purchase just in time. A purchase is declined if the card is frozen, over its daily limit, or beyond the allowance or USDC balance.
- **Card details.** Shown only in Stripe.js Issuing Elements, with a 15-minute ephemeral key bound to the card and a browser nonce, after a fresh passkey confirmation. Aura never handles the card number.
- **Phone wallets.** Stripe's "Add to Wallet" button element is a private preview, live mode only. It sits behind `card_wallets` and is untested with real wallets.
- **Disputes.** `POST /v1/issuing/disputes`, then `/submit`, once per settled transaction within 110 days. Credits return to the account's USDC on Base.
- **API version.** Pinned to `2026-03-25.preview`. Confirm it with Bridge before going live.

Nothing has run against a real Bridge card program or Stripe account yet; the flow is tested against local fakes (`apps/web/tests/unit/cards.test.ts`, `apps/web/tests/e2e/cards.spec.ts`).
