# Aurel architecture

## Principle

Aurel is an orchestration and presentation layer, not a bank ledger. Aurel must remain recoverable from its providers and public chains. Deleting the application database must never delete customer money, change a customer balance, or make ownership ambiguous.

## Systems of record

| Domain | Authoritative source | What Aurel may store |
| --- | --- | --- |
| Wallets and signers | Privy and the configured custody/signer arrangement | Wallet references, user labels, policy-display cache |
| Fiat accounts, KYC and transfers | Bridge or Rain for the program they operate | Provider object IDs, workflow state, last observed status |
| Cards and card transactions | Issuer/processor exposed through Bridge or Rain | Card references, redacted display data, pending UI projection |
| Crypto balances and DeFi positions | Relevant blockchain and protocol contracts | Indexed projections with chain, block, transaction, and observation metadata |
| Market value | Named market-data provider | Short-lived, timestamped price observations |
| Membership and benefits | Aurel policy plus benefit provider | Rebuildable qualification result and entitlement references |

## Cloudflare platform

- **Workers + Static Assets:** web application, documentation, API, provider adapters, and webhook ingress.
- **Workflows:** resumable operations spanning user confirmation, provider callbacks, or chain finality.
- **Queues:** webhook buffering and projection refreshes when traffic warrants it.
- **D1:** optional disposable projections, preferences, consent receipts, support annotations, and idempotency records.
- **KV / Workers Cache:** feature configuration, bounded quote caching, and read-through caches.
- **R2:** optional generated exports or encrypted evidence whose canonical source remains known.
- **Workers Secrets:** provider and RPC credentials.
- **WAF, Turnstile, rate limiting, API Shield:** layered protection as the public surface expands.

The initial demo intentionally uses no database.

## Rules for application data

1. Every financial observation includes its source, external ID, status, and `observedAt` value.
2. Projections are replaceable. They have schemas and rebuild jobs, not data ownership semantics.
3. A command is not successful because Aurel wrote a row. Success comes from an authoritative provider response or chain receipt.
4. Webhook receipt and idempotency state prevent duplicate work; they never create financial truth.
5. Stale or unavailable sources are displayed as stale or unavailable. The UI does not silently carry a previous value forward as current.
6. Sensitive provider payloads are minimized and redacted. KYC documents should stay with the KYC provider.

## Recovery test

The recurring disaster-recovery exercise is: erase all Aurel read models, reconnect provider references, replay signed provider events, query the authoritative APIs and chains, and rebuild the same customer view. Any feature that cannot pass this test needs an explicit exception and risk review.

