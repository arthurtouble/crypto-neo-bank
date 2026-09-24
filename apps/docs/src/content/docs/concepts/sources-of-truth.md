---
title: Sources of truth
description: Which system is authoritative for balances, identity, controls, and transaction evidence.
---

Aura is not the authoritative balance ledger. Financial ownership and settlement live with public chains, protocol contracts, and future regulated providers.

That design reduces custody and bookkeeping risk, but “not the ledger” does not mean “no important data.” Aura still keeps security settings, customer instructions, consent records, support cases, and transaction evidence that must be protected and recoverable.

## Authority by data type

| Data | Authoritative source | Aura's role |
| --- | --- | --- |
| Wallet asset balance | Public chain | Read, normalize, cache, and display |
| DeFi position | Protocol contracts | Read position and market state; prepare supported actions |
| Transaction settlement | Chain receipt or provider record | Track references, recheck status, and explain exceptions |
| Customer authentication | Privy-verified identity | Protect customer-scoped records and sessions |
| Wallet control | Customer and wallet infrastructure | Request customer confirmation; never hold an Aura signing key |
| Security preferences | Customer instruction stored by Aura | Enforce inside Aura and retain an audit trail |
| Future fiat balance | Contracted regulated provider | Display the provider record and reconcile events |
| KYC decision | Future regulated provider | Consume the minimum status needed for access decisions |
| Support case | Aura | Retain the request, handling record, and outcome |
| Product analytics | Aura | Measure approved product events; never substitute for balances |

## What can be rebuilt

Wallet balances, protocol positions, and confirmed public-chain receipts can be read again from their authoritative sources. Aura may cache or project that information for speed.

A rebuild is still an operational event. It can take time, upstream endpoints can disagree or be unavailable, and historical context may be harder to reconstruct than current state.

## What cannot be casually discarded

Customer security preferences, saved destinations, cooling timestamps, policy decisions, consent versions, support correspondence, and provider-event processing records are not disposable caches. Losing them may not change an onchain balance, but it could weaken controls or prevent Aura from explaining what happened.

These records require controlled access, backup, restoration tests, retention rules, and deletion procedures that reflect their purpose.

## Reconciliation

Reconciliation compares Aura's view with the authoritative system. It does not make the projection authoritative.

For an onchain transaction, that means checking the requested chain, transaction hash, receipt status, block, and expected action. For a future provider event, it means comparing event history, provider API state, and the customer-facing record. Differences become operations exceptions rather than being silently overwritten.

## During an incident

If Aura cannot trust its application records, affected instruction paths should pause. Operations restores retained evidence, replays idempotent events, rereads chain or provider state, and records any unresolved gap.

The customer may still control assets through the underlying wallet. That is an important recovery property, but it does not make an unexplained policy or evidence gap acceptable.

