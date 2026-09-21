---
title: Sources of truth
description: Which system is authoritative for balances, identity, controls, and transaction evidence.
---

Aurel is not the authoritative balance ledger. Financial ownership and settlement live with public chains, protocol contracts, and future regulated providers.

That design reduces custody and bookkeeping risk, but “not the ledger” does not mean “no important data.” Aurel still keeps security settings, customer instructions, consent records, support cases, and transaction evidence that must be protected and recoverable.

## Authority by data type

| Data | Authoritative source | Aurel's role |
| --- | --- | --- |
| Wallet asset balance | Public chain | Read, normalize, cache, and display |
| DeFi position | Protocol contracts | Read position and market state; prepare supported actions |
| Transaction settlement | Chain receipt or provider record | Track references, recheck status, and explain exceptions |
| Customer authentication | Privy-verified identity | Protect customer-scoped records and sessions |
| Wallet control | Customer and wallet infrastructure | Request customer confirmation; never hold an Aurel signing key |
| Security preferences | Customer instruction stored by Aurel | Enforce inside Aurel and retain an audit trail |
| Future fiat balance | Contracted regulated provider | Display the provider record and reconcile events |
| KYC decision | Future regulated provider | Consume the minimum status needed for access decisions |
| Support case | Aurel | Retain the request, handling record, and outcome |
| Product analytics | Aurel | Measure approved product events; never substitute for balances |

## What can be rebuilt

Wallet balances, protocol positions, and confirmed public-chain receipts can be read again from their authoritative sources. Aurel may cache or project that information for speed.

A rebuild is still an operational event. It can take time, upstream endpoints can disagree or be unavailable, and historical context may be harder to reconstruct than current state.

## What cannot be casually discarded

Customer security preferences, saved destinations, cooling timestamps, policy decisions, consent versions, support correspondence, and provider-event processing records are not disposable caches. Losing them may not change an onchain balance, but it could weaken controls or prevent Aurel from explaining what happened.

These records require controlled access, backup, restoration tests, retention rules, and deletion procedures that reflect their purpose.

## Reconciliation

Reconciliation compares Aurel's view with the authoritative system. It does not make the projection authoritative.

For an onchain transaction, that means checking the requested chain, transaction hash, receipt status, block, and expected action. For a future provider event, it means comparing event history, provider API state, and the customer-facing record. Differences become operations exceptions rather than being silently overwritten.

## During an incident

If Aurel cannot trust its application records, affected instruction paths should pause. Operations restores retained evidence, replays idempotent events, rereads chain or provider state, and records any unresolved gap.

The customer may still control assets through the underlying wallet. That is an important recovery property, but it does not make an unexplained policy or evidence gap acceptable.

