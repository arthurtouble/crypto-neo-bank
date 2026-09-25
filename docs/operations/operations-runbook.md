---
title: Operations and recovery runbook
description: Routine operations, reconciliation, recovery, escalation, and evidence procedures.
---

## Operating premise

Aurel can lose its D1 data without losing customer funds because Privy, contracted providers, and public chains remain financially authoritative. D1 also contains Aurel-specific security decisions, customer instructions, consent evidence, cases, and audit history. Those records are not a balance ledger, but they are not disposable and must be retained and backed up according to the approved policy.

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

## D1 loss or corruption

1. Create a replacement D1 database and apply every migration.
2. Reattach the binding to both Workers.
3. Restore the latest verified evidence backup before accepting new customer instructions.
4. Query provider APIs and chains directly.
5. Rebuild wallet, fiat, card, position, and membership projections with source metadata.
6. Re-run reconciliation. Customer balances must match authoritative systems independently of the D1 restore.
7. Treat any gap in consent, security-policy, case, or administrative audit evidence as an incident; do not invent or infer missing acceptance.

## Production release

1. Run `pnpm lint`, `pnpm typecheck:all`, `pnpm test:unit`, `pnpm test:e2e`, and `pnpm deploy:dry-run`.
2. Apply pending D1 migrations before code that requires the new schema.
3. Run `pnpm release:upload` to create an undeployed candidate and use its preview URL for smoke tests.
4. On a custom domain, configure version affinity before splitting traffic so a session receives consistent code and static assets.
5. Deploy the candidate initially to a small percentage with `wrangler versions deploy <old>@95 <candidate>@5`, observe errors and key journeys, then promote deliberately.
6. Stop the rollout and use `pnpm release:rollback` if authentication, policy, transaction preparation, asset reads, or support intake regress.
7. A code rollback does not roll back D1. Database changes must remain backward-compatible through the rollout window.

## Service targets

- Application availability target: 99.95%, excluding upstream chain/provider incidents shown as degraded dependencies.
- Supported route preparation success: at least 98% when a provider route is available.
- Submitted transaction traceability: 100% have an intent ID and, after signing, a transaction hash.
- Stale submitted transaction investigation: open an issue after 15 minutes without a source receipt.
- Urgent security/funds-at-risk case: acknowledge within 15 minutes during published coverage.
- Normal case: first response within one business day.

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

## Recovery exercise record

The release drill for 21 September 2026 verified the recovery design without touching customer assets:

1. Applied the complete D1 migration set to a clean disposable database namespace.
2. Rebuilt the deterministic provider projection from source adapters and verified position provenance.
3. Exercised duplicate webhook detection, invalid signatures, policy denial, and provider failure states in automated tests.
4. Verified authenticated activity is derived from replaceable intent evidence while live balances come directly from Base RPC reads.
5. Verified the operations reconciliation surface denies access unless a Privy subject is explicitly allowlisted.
6. Confirmed no automated test or recovery step signs or broadcasts a value-moving transaction.

Repeat this drill before enabling a regulated provider, after any persistence-schema change, and at least quarterly once real customer workflows are active. Record the date, operator, database target, discrepancies, and remediation in the incident system; never place customer secrets or raw KYC evidence in the record.
