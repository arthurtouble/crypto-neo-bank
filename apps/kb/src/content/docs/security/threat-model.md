---
title: Threat model
description: Assets, trust boundaries, threats, controls, and residual risks.
---

## Assets and trust boundaries

Customer signing authority remains in Privy customer-controlled wallets. Public chains and contracted providers are authoritative for assets and settlement. Aurel controls transaction preparation, policy decisions, product disclosures, provider routing, support evidence, and operational access; compromise of these controls can still cause a customer to approve a harmful transaction.

## Priority threats and controls

| Threat | Prevent | Detect and recover |
| --- | --- | --- |
| Session theft | Privy token verification, passkey enrollment, short-lived sessions | Customer emergency lock, audit events, Privy session response |
| Destination substitution | Server policy, address book, cooling period, final wallet confirmation | Intent/request evidence, transaction hash, support escalation |
| Malicious transaction plan | Chain/asset/destination allowlists, RPC simulation, exact token approvals | Reverted receipt detection, provider/route disablement |
| Excessive or automated withdrawal | Rolling limits, optional saved-only mode, Turnstile on abuse-prone intake | Rate limits, product events, issue queue |
| Replay or forged webhook | HMAC, timestamp tolerance, stable event ID | Duplicate receipt record, Queue retry/DLQ, reconciliation |
| Operator abuse | Explicit Privy-subject allowlist, deny by default, no operator signer | Append-only audit evidence and issue history |
| Projection corruption | Never authorize from a projected balance; validate provider and chain state | Rebuild projections and reconcile authoritative sources |
| Support social engineering | Never request recovery secrets; no concierge signing tools | Case audit trail, emergency lock, human escalation |
| Dependency compromise | Pinned critical dependencies, CI, narrow provider adapters | Disable affected feature, preserve unaffected read paths |
| Cross-chain partial completion | Tested matrix, route disclosure, source/destination distinction | Persistent route reference, LI.FI/provider status recovery |

## Explicit non-goals

- Aurel cannot reverse a confirmed blockchain transfer.
- Aurel cannot guarantee stablecoin parity, protocol solvency, bridge liquidity, or chain availability.
- A successful source-chain transaction is not evidence of destination receipt.
- Aurel policy controls govern transactions prepared through Aurel; they do not prevent a customer from exporting a wallet and transacting elsewhere.

Review this model before enabling a new chain, asset, protocol, provider, delegated signer, smart contract, or operator capability.
