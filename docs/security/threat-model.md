---
title: Threat model
description: Assets, trust boundaries, threats, controls, and residual risks.
---

## Assets and trust boundaries

Customer signing authority remains with the customer's Privy signer, which owns their smart wallet on Base. Public chains and contracted providers are authoritative for assets and settlement. Aurel controls action preparation, customer controls, route quotes, product disclosures, provider routing, support evidence, and operational access; compromise of these controls can still cause a customer to approve a harmful transaction.

## Priority threats and controls

| Threat | Prevent | Detect and recover |
| --- | --- | --- |
| Session theft | Privy token verification, short-lived sessions | Customer emergency lock, audit events, Privy session response |
| Destination substitution | Optional saved-recipients-only mode, new-recipient cooling, final wallet confirmation | Action evidence, verified `Transfer` effect, transaction hash, support escalation |
| Malicious transaction plan | Server-built calls, exact approvals batched with the action, LI.FI Diamond pinned as call target and spender, price-impact cap | Verifier checks decoded calls equal prepared calls and expected events are present; feature switch |
| Quote tampering | Quotes held server-side (45 s); browser sees only a quote ID | Source debit and minimum output verified onchain |
| Excessive or automated withdrawal | Optional daily limit, saved-recipients-only mode, Turnstile on abuse-prone intake | Rate limits, product events, issue queue |
| Replay or forged webhook | HMAC, timestamp tolerance, stable event ID | Duplicate receipt record, Queue retry/DLQ, reconciliation |
| Operator abuse | Explicit Privy-subject allowlist, deny by default, no operator signer | Append-only audit evidence and issue history |
| Projection corruption | Never authorize from a projected balance; validate provider and chain state | Rebuild projections and reconcile authoritative sources |
| Support social engineering | Never request recovery secrets; support has no signing or action tools | Case audit trail, emergency lock, human escalation |
| Dependency compromise | Pinned critical dependencies, CI, narrow provider adapters | Disable affected feature, preserve unaffected read paths |
| Cross-chain partial completion | Route disclosure, source/destination distinction | Action stays `settling` until LI.FI status and the destination receipt show the minimum output |
| Exported key used elsewhere | Not prevented: Aura controls apply only to actions Aura prepares | Onchain enforcement through a smart-wallet module is a later feature |

## Explicit non-goals

- Aurel cannot reverse a confirmed blockchain transfer.
- Aurel cannot guarantee stablecoin parity, protocol solvency, bridge liquidity, or chain availability.
- A successful source-chain transaction is not evidence of destination receipt.
- Aura controls govern actions prepared through Aura; they do not bind a key exported and used elsewhere.

Review this model before enabling a new chain, asset, protocol, provider, delegated signer, smart contract, or operator capability.
