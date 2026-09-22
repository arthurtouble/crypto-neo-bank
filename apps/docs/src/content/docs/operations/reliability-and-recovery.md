---
title: Reliability and recovery
description: Availability targets, failure handling, reconciliation, backups, and restoration priorities.
---

Aurel depends on systems it does not operate: wallet infrastructure, public networks, RPC endpoints, protocols, route providers, and future regulated partners. Reliability means handling those dependencies honestly, not claiming they never fail.

## Operating targets

| Measure | Launch target |
| --- | ---: |
| Product availability | 99.95%, excluding upstream outages |
| Route-quote success | At least 98% while routing dependencies are available |
| Transaction traceability | 100% of Aurel-prepared submissions |
| Stale-transaction investigation | Trigger after 15 minutes unresolved |
| Urgent support acknowledgement | 15 minutes during coverage |
| Normal first response | One business day |

These are operating objectives, not historical performance claims or contractual service levels.

## Degraded dependencies

An upstream failure should affect the smallest possible part of the product. If route discovery is unavailable, direct Base activity and security settings should remain usable. If market data is stale, transaction preparation that depends on it should stop rather than showing an old quote as current.

The interface should distinguish unavailable, delayed, and failed. A timeout must not be rendered as a completed transaction.

## Rebuildable balances

Canonical wallet balances and protocol positions can be reread from chains and contracts. This makes recovery less dependent on an internal ledger.

Rebuildable does not mean disposable. Security settings, transaction instructions, consent, provider-event history, and support records require backup because authoritative external systems do not contain the complete customer and policy context.

## Recovery sequence

For a material data or event-processing incident:

1. pause affected instruction paths;
2. preserve logs, queue evidence, and current database state;
3. identify the last trusted migration and backup;
4. restore retained application evidence;
5. replay only idempotent events;
6. reread relevant chain and provider state;
7. reconcile every affected instruction;
8. record unresolved gaps and customer impact;
9. reopen features gradually after verification.

Operations should never invent a confirmed state to make the interface look complete.

Portfolio source replays put historical chart and tax views on hold. The last calculated rows are retained for recovery, but they are not presented as current until fresh source checkpoints and a new calculation are published together. If that publication cannot complete, those views remain unavailable rather than falling back to old numbers.

## Scheduled checks

A five-minute scheduled process can identify submitted transactions that remain unresolved, reviewed actions that have expired, and provider events that failed or stopped progressing. The schedule creates detection opportunities; it does not guarantee that every upstream problem is known within five minutes.

## Observability

Cloudflare Worker logs and traces support debugging and incident response. Production logging should be structured around request references, provider event IDs, transaction hashes, and safe error categories.

Secrets, authentication tokens, private keys, recovery material, full identity documents, and unnecessary personal data do not belong in logs.

## Restoration testing

A backup is not evidence of recoverability until it has been restored in an isolated environment. Recovery drills should verify schema compatibility, security settings, event idempotency, transaction history, and reconciliation output—not merely that a database file can be opened.

## Customer communication

During an incident, Aurel should say which features are affected, what customers should avoid repeating, whether underlying assets remain accessible, and when the next useful update is expected. Communication should separate known facts from investigation.
