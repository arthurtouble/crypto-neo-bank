---
title: Provider events
description: How Aurel authenticates, queues, processes, retries, and reconciles asynchronous provider updates.
---

Future identity, payment, card, and settlement providers report changes asynchronously. These events can arrive late, more than once, or out of order. A successful HTTP response is not enough to build a reliable financial workflow.

## Intake

The provider-event endpoint verifies an HMAC-SHA-256 signature before accepting an event. It rejects timestamps outside a five-minute tolerance and requires a provider event identifier.

The signature establishes that the request came from someone with the shared secret and that the signed payload was not altered. It does not prove that the provider's underlying decision is correct.

## Idempotency

Providers retry webhooks. Aurel uses the provider event identifier to ensure that receiving the same event again does not create a second logical transition.

Idempotency must cover both intake and side effects. Recording an event only once is not enough if a retry can still create a second support case, entitlement, or customer notification.

## Queue processing

Accepted events enter Cloudflare Queues. The public request can finish quickly while processing happens separately. This isolates provider retries from temporary internal failures and lets the consumer apply controlled retry behavior.

An event can retry up to five times. A repeatedly failing event moves to dead-letter handling. Dead-letter intake retains the failure evidence and opens a critical operations issue instead of silently discarding the update.

## Ordering

Events may arrive out of order. Aurel should use provider timestamps, versions, and current provider state where available rather than assuming delivery order is business order.

For a status that matters financially or legally, reconciliation reads the current provider record. Webhooks are a prompt to update and investigate; they are not always the sole source of truth.

## Reconciliation

Scheduled operations compare:

- accepted and processed event records;
- items waiting in the queue or dead-letter path;
- the current provider state;
- Aurel's customer-facing projection;
- related transaction or support evidence.

A mismatch becomes an operations exception. It should not be hidden by overwriting the older record without preserving the transition.

## Secret management

Webhook signing secrets remain server-side Cloudflare bindings. They are not exposed as public environment values or committed to the repository. Production onboarding needs a rotation procedure that can accept old and new secrets during a controlled overlap.

## Provider-specific launch work

The generic intake mechanics are implemented, but every real integration still needs:

- the provider's exact signature scheme and payload schema;
- event ownership and severity mapping;
- schema-version handling;
- key rotation and emergency revocation;
- reconciliation endpoints and cadence;
- replay and dead-letter procedures;
- customer notification rules;
- retention and redaction decisions;
- tested incident scenarios.

Bridge, Rain, or another provider is not “integrated” merely because a generic webhook endpoint exists.

