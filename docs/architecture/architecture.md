---
title: Aurel architecture
description: System boundaries, sources of truth, runtime flows, and recovery rules.
---

## Principle

Aurel prepares, checks, and presents money movements; it is not a bank ledger. Aurel must remain recoverable from its providers and public chains. Deleting the application database must never delete customer money, change a customer balance, or make ownership ambiguous.

## Systems of record

| Domain | Authoritative source | What Aurel may store |
| --- | --- | --- |
| Wallets and signers | Privy and the configured custody/signer arrangement | Wallet references, user labels, policy-display cache |
| Fiat accounts, KYC and transfers | Bridge | Provider object IDs, workflow state, last observed status |
| Cards and card transactions | Stripe Issuing (card, controls, authorizations, transactions, disputes) with Bridge (card approval and USDC collection); the spending allowance on Base | Which card is the customer's (`card_account_projections`), and a replaceable record of card payments as Stripe reported them for operators (`card_observations`) |
| Crypto balances and DeFi positions | Relevant blockchain and protocol contracts | Indexed projections with chain, block, transaction, and observation metadata |
| Market value | Named market-data provider | Short-lived, timestamped price observations |

## Cloudflare platform

- **Workers + Static Assets:** web application, documentation, API, provider adapters, and webhook ingress.
- **Cloudflare Access:** staff sign-in for the operations app. The web app verifies Access's signed token on every operator API request.
- **Service bindings:** the operations Worker reaches the web app's operator APIs directly, not over the public internet.
- **Workflows:** resumable operations spanning user confirmation, provider callbacks, or chain finality.
- **Queues:** webhook buffering and projection refreshes when traffic warrants it.
- **D1:** optional disposable projections, preferences, consent receipts, support annotations, and idempotency records.
- **KV / Workers Cache:** feature configuration, bounded quote caching, and read-through caches.
- **R2:** optional generated exports or encrypted evidence whose canonical source remains known.
- **Workers Secrets:** provider and RPC credentials.
- **WAF, Turnstile, rate limiting, API Shield:** layered protection as the public surface expands.

The demo UI does not require a database. D1 is attached only for webhook replay protection, consent/preferences, and disposable projection jobs. It never determines whether customer money exists or settled.

## Runtime flow

```mermaid
flowchart LR
    UI[Aurel web client] --> WEB[vinext Worker]
    WEB --> PRIVY[Privy adapter]
    WEB --> BRIDGE[Bridge adapter]
    WEB --> STRIPE[Stripe Issuing adapter]
    WEB --> CHAIN[Chains and protocols]
    PRIVY -->|signed event| HOOK[Webhook route]
    BRIDGE -->|signed event| HOOK
    STRIPE -->|signed event| HOOK
    HOOK --> D1[(D1 replay metadata)]
    HOOK --> QUEUE[Provider-events Queue]
    QUEUE --> CONSUMER[Event consumer Worker]
    CONSUMER --> D1
    CONSUMER -->|refresh request| PRIVY
    CONSUMER -->|refresh request| BRIDGE
    CONSUMER -->|re-index| CHAIN
    OPUI[Operator browser] --> ACCESS[Cloudflare Access]
    ACCESS -->|signed token| OPS[Operations Worker]
    OPS -->|service binding, /api/ops| WEB
```

Customer money movements follow the [money actions](money-actions.md) pipeline: the server prepares exact calls and builds a `wallet_sendCalls` request, the customer's browser signs a Privy authorization signature, the server relays it through Privy with gas sponsored, and the server verifies the result from chain evidence. See [accounts and custody](accounts-and-custody.md).

The command path returns provider receipts. The event path refreshes read models. Neither path fabricates settlement from an Aurel database write.

## Operations app

Staff use a separate app, `apps/ops` (Worker `aurel-ops`, dev `aura-dev-ops`). It is a Vite and React page served by its own Worker (`apps/ops/src/worker.ts`). Customers never reach it, and the customer app has no operations pages.

- **Sign-in.** Cloudflare Access sits in front of the ops Worker. Only people on the Access policy get in, and Access adds its signed token in `Cf-Access-Jwt-Assertion`.
- **Forwarding.** The Worker serves the page and forwards `/api/<path>` to the web app's `/api/ops/<path>` over the `WEB` service binding (`aurel-financial-os` in production, `aura-dev` in dev). It passes on only the Access token and the content type and accept headers. Cookies and Privy tokens stay behind, and it refuses paths outside `/api/ops`.
- **Checking.** The web app doesn't trust the forwarder. `requireOperator` (`apps/web/src/lib/auth/access.ts`) verifies the token on every operator request: the RS256 signature against the team's published keys at `<team domain>/cdn-cgi/access/certs` (cached for 10 minutes, fetched again once for an unknown key ID), the issuer (the team domain), the audience (the ops application's AUD tag), expiry and not-before with 60 seconds of clock skew, and a person's email. Service tokens are refused. A customer's Privy session is never an operator.
- **Configuration.** `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are web app variables, not secrets. If either is empty, every operator request is refused.
- **Audit.** Every operator change records the operator's email: in `audit_events.actor_reference`, and in `updated_by`, `paused_by`, or `assigned_to` on the changed row.

The operator APIs read D1 and the chain like the rest of the app. Stats come from D1 records only, so they are a view of Aura's own actions, not a ledger. See [screen data](frontend-data.md#operations-app) for the endpoints and [edge security activation](../operations/edge-security-activation.md#cloudflare-access) for the Access setup.

## Rules for application data

1. Every financial observation includes its source, external ID, status, and `observedAt` value.
2. Projections are replaceable. They have schemas and rebuild jobs, not data ownership semantics.
3. A command is not successful because Aurel wrote a row. Success comes from an authoritative provider response or chain receipt.
4. Webhook receipt and idempotency state prevent duplicate work; they never create financial truth.
5. Stale or unavailable sources are displayed as stale or unavailable. The UI does not silently carry a previous value forward as current.
6. Sensitive provider payloads are minimized and redacted. KYC documents should stay with the KYC provider.

## Recovery test

The recurring disaster-recovery exercise is: erase all Aurel read models, reconnect provider references, replay signed provider events, query the authoritative APIs and chains, and rebuild the same customer view. Any feature that cannot pass this test needs an explicit exception and risk review.
