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
- membership and benefits;
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
- Webhook signing secret and current event catalog.
- Recovery behavior and user-facing wording approved by Privy.

### Implementation sequence

1. Set `NEXT_PUBLIC_PRIVY_APP_ID` locally and in the Cloudflare environment.
2. Replace `DemoIdentityAdapter` behind the `IdentityAdapter` interface.
3. Replace `DemoWalletAdapter` behind the `WalletAdapter` interface.
4. Map Privy user and wallet IDs to opaque Aurel references. Do not store key material.
5. Enforce passkey or step-up authentication before signing material-value commands.
6. Map Privy webhook events into the normalized provider-event envelope.
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
5. Verify Bridge events at ingress and normalize them before the Queue boundary.
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
pnpm --filter @aurel/web exec wrangler secret put PROVIDER_WEBHOOK_SECRET
pnpm typecheck:all
pnpm test
pnpm deploy:dry-run
```

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
