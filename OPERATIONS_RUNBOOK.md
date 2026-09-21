# Operations and recovery runbook

## Operating premise

Aurel can lose its D1 data without losing customer funds. Privy, Bridge/Rain, issuers, and public chains remain authoritative. D1 contains operational evidence and replaceable projections only.

## Daily controls

1. Review Queue backlog, retry counts, and the dead-letter queue.
2. Review webhook receipts left in `received`, `enqueued`, or `failed` state beyond the expected processing window.
3. Reconcile provider transfer/card states and onchain positions against the latest Aurel projection.
4. Escalate stale observations; do not silently display them as current.
5. Sample high-value commands to confirm step-up authentication, policy checks, and provider receipts.

## Webhook incident

1. Confirm signature rejection or schema failure from structured Worker logs using `traceId`.
2. Do not disable signature or timestamp verification to restore traffic.
3. Confirm the provider’s active secret and signing format through an authenticated support channel.
4. Rotate the Worker secret if exposure is suspected.
5. Replay provider events by their stable event IDs. Duplicates are safe because `webhook_receipts.event_id` is unique.
6. Rebuild affected projections from provider APIs or chains after replay.

## Queue or consumer incident

1. Pause the consumer if downstream writes are corrupt or a provider dependency is failing repeatedly.
2. Inspect retries and dead-letter messages; preserve the original event ID.
3. Repair the consumer and replay into the normal Queue.
4. Verify `webhook_receipts.processing_status` and the resulting refresh record.
5. Reconcile the affected external object before marking the incident resolved.

## Projection database loss

1. Create a replacement D1 database and apply every migration.
2. Reattach the binding to both Workers.
3. Retrieve customer/provider references from the approved identity mapping source.
4. Query provider APIs and chains directly.
5. Rebuild wallet, fiat, card, position, and membership projections with source metadata.
6. Re-run reconciliation. Customer balances must match authoritative systems without restoring a D1 backup.

## Command ambiguity

If Aurel times out after sending a command:

1. Do not submit a second command with a new idempotency key.
2. Query the provider using the original key or provider object reference.
3. Display “status unknown—checking provider,” never “failed,” until authoritative status is known.
4. Reconcile the provider object and only then permit a retry.

## Security escalation

- Freeze or restrict through the authoritative provider first when the contractual program supports it.
- Preserve trace IDs, provider object IDs, chain transaction hashes, timestamps, and consent versions.
- Never copy full KYC documents, seed phrases, private keys, or unredacted card data into tickets, logs, D1, or chat systems.
- Treat a provider outage as a degraded dependency, not permission to bypass controls.
