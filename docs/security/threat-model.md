---
title: Threat model
description: Assets, trust boundaries, threats, controls, and residual risks.
---

## Assets and trust boundaries

- Signing authority stays with the customer's Privy embedded wallet, the same address on every EVM network. Privy signs only after the customer's authorization signature, and money moves only once a passkey or authenticator app is enrolled.
- Public chains and contracted providers are authoritative for assets and settlement.
- Aura controls action preparation, customer controls, route quotes, product disclosures, provider routing, support evidence, and operational access. Compromise of these can still lead a customer to approve a harmful transaction.

## Priority threats and controls

| Threat | Prevent | Detect and recover |
| --- | --- | --- |
| Session theft | Privy token verification, short-lived sessions; loosening a control needs a server-verified passkey confirmation, so a stolen session can't undo a lock or a limit | Customer emergency lock, audit events, Privy session response |
| Destination substitution | Optional saved-recipients-only mode, new-recipient cooling, final wallet confirmation | Action evidence, verified `Transfer` effect, transaction hash, support escalation |
| Malicious transaction plan | Server-built calls, exact approvals batched with the action, LI.FI Diamond pinned as call target and spender, price-impact cap | Verifier checks decoded calls equal prepared calls and expected events are present; feature switch |
| Quote tampering | Quotes held server-side (45 s); browser sees only a quote ID | Source debit and minimum output verified onchain |
| Excessive or automated withdrawal | Optional daily limit, saved-recipients-only mode, application rate limits | Rate-limit records, product events, issue queue |
| Replay or forged webhook | Per-provider signature and timestamp checks, provider taken from the URL, stable event ID ([provider projections](../architecture/provider-projections.md)) | Duplicate receipt record, Queue retry/DLQ, reconciliation |
| Card theft or misuse | Card details only in Stripe's frames after a fresh passkey confirmation (ephemeral key bound to the card and a browser nonce, 15 minutes); unfreezing and raising the limit need step-up; spending capped by the card's daily limit and the on-chain allowance | Freeze card; account lock also freezes the card; security notices for card created, unfrozen, and limit raised; disputes through Stripe |
| Operator abuse | Separate operations app behind Cloudflare Access with a named-email policy; the web app verifies the Access token on every operator request, deny by default; customer sessions are never operators; no operator signer; operators can lock but only the customer unlocks | Append-only audit evidence with the operator's email on every change, and issue history |
| Projection corruption | Never authorize from a projected balance; validate provider and chain state | Rebuild projections and reconcile authoritative sources |
| Support social engineering | Never request recovery secrets; support has no signing or action tools | Intercom conversation history, emergency lock, human escalation |
| Dependency compromise | Pinned critical dependencies, CI, narrow provider adapters | Disable affected feature, keep unaffected read paths |
| Cross-chain partial completion | Route disclosure, source/destination distinction | Action stays `settling` until LI.FI status and the destination receipt show the minimum output |
| Exported key used elsewhere | Not prevented | Enforcement at the wallet (for example Privy wallet policies) is a later feature |

## Explicit non-goals

- Aura can't reverse a confirmed blockchain transfer.
- Aura can't guarantee stablecoin parity, protocol solvency, bridge liquidity, or chain availability.
- A successful source-chain transaction is not evidence of destination receipt.
- Aura controls govern only actions prepared through Aura; they don't bind a key exported and used elsewhere.

Review this model before enabling a new chain, asset, protocol, provider, delegated signer, smart contract, or operator capability.
