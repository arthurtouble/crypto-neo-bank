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
5. Review actions left `submitted` or `settling` (operations app → Money movement → Stuck only), and sample confirmed actions against their chain evidence.
6. Review notices whose email or push is `failed`, or still `pending` after several cron runs (`SELECT kind, email_status, push_status, delivery_attempts FROM notifications WHERE email_status IN ('pending','failed') OR push_status IN ('pending','failed')`). The cron logs `notifications.deliver.failed`; a run of Resend refusals usually means the sending domain or key changed.

## Webhook incident

1. Confirm signature rejection or schema failure from structured Worker logs using `traceId`.
2. Do not disable signature or timestamp verification to restore traffic.
3. Confirm the provider’s active key or secret and signing format through an authenticated support channel. Bridge signs with RSA (`BRIDGE_WEBHOOK_PUBLIC_KEY`), Privy with Svix (`PRIVY_WEBHOOK_SECRET`), Stripe with HMAC-SHA256 in `Stripe-Signature` (`STRIPE_WEBHOOK_SECRET`).
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
5. Rebuild wallet, fiat, card, and position projections with source metadata.
6. Re-run reconciliation. Customer balances must match authoritative systems independently of the D1 restore.
7. Treat any gap in consent, security-policy, case, or administrative audit evidence as an incident; do not invent or infer missing acceptance.

## Production release

1. Run `pnpm lint`, `pnpm typecheck:all`, `pnpm test:unit`, `pnpm test:e2e`, and `pnpm deploy:dry-run`.
2. Apply pending D1 migrations before code that requires the new schema.
   The operations app needs, per environment: its Worker deployed (`aurel-ops`, or `aura-dev-ops` with `pnpm ops:deploy:dev`), Cloudflare Access turned on in front of it, and the web app's `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` variables set (see [edge security activation](edge-security-activation.md#cloudflare-access)). Until then every operator request is refused.
   Notifications need, per environment: a Resend domain verified for `EMAIL_FROM` and the `RESEND_API_KEY` secret (a send-only key), `APP_ORIGIN`, and a VAPID key pair made for that environment (`VAPID_PUBLIC_KEY` as a variable, `VAPID_PRIVATE_KEY` as a secret). Without them, email or push is skipped and the in-app notices still work.
3. Run `pnpm release:upload` to create an undeployed candidate and use its preview URL for smoke tests.
4. On a custom domain, configure version affinity before splitting traffic so a session receives consistent code and static assets.
5. Deploy the candidate initially to a small percentage with `wrangler versions deploy <old>@95 <candidate>@5`, observe errors and key journeys, then promote deliberately.
6. Stop the rollout and use `pnpm release:rollback` if authentication, customer controls, action preparation or verification, asset reads, or support intake regress.
7. A code rollback does not roll back D1. Database changes must remain backward-compatible through the rollout window.

## Service targets

- Application availability target: 99.95%, excluding upstream chain/provider incidents shown as degraded dependencies.
- Supported route preparation success: at least 98% when a provider route is available.
- Action traceability: 100% have an action ID and, after signing, a transaction hash.
- Stale action investigation: open an issue after 15 minutes `submitted` without a receipt, or `settling` without delivery.
- Urgent security/funds-at-risk case: acknowledge within 15 minutes during published coverage.
- Normal case: first response within one business day.

## Command ambiguity

If Aurel times out after sending a command:

1. Do not submit a second command with a new idempotency key.
2. Query the provider using the original key or provider object reference.
3. Display “status unknown—checking provider,” never “failed,” until authoritative status is known.
4. Reconcile the provider object and only then permit a retry.

## Operations app

Operators work in the operations app (`apps/ops`), a separate Worker behind Cloudflare Access. Sign in through Access with your own email; there is no shared account. The web app checks your Access token on every request and records your email on every change. See [architecture](../architecture/architecture.md#operations-app).

- **Customers:** every customer, newest sign-up first, 50 at a time with **Load more**; select one to open it. Or find a customer by Privy user ID, email, wallet address, or Aura tag. See their controls, Aura tag, Bridge status, card, action counts, whether the account can be closed, and their Intercom user ID for finding their conversations in Intercom. Lock, close, or reopen, each with a reason.
- **Money movement:** opened from a customer, everything on their account as they see it in Transactions, including money that arrived from outside Aura and card payments; a source that can't be read says so. Otherwise, every customer's Aura actions, newest first, filtered by status, kind, customer, or stuck only (submitted over 15 minutes with no receipt, or settling over 2 hours). Open one to see its journey. Check an open action against the chain now; the check is audited.
- **Stats:** customers, completed, failed, and stuck actions, volume by kind, the new-customer funnel, and a by-day table, for 7, 30, or 90 days. They come from D1 records only, so money that arrived without an Aura action isn't counted. Don't use them as balances.
- **Controls:** feature switches (on or off), asset pauses (pause with a reason, resume), and issues (look for stuck actions and failed provider events, then acknowledge or resolve), with provider event counts and checks.

### Locking an account to protect a customer

Lock an account when it looks like someone else is using it, for example after a report in the support chat. Confirm the customer in the conversation first, as for closing below.

1. In Customers, find the account and press Lock account. Give a reason, such as the Intercom conversation link.
2. Sending stops at once, including actions already prepared. Aura tries to freeze the card at Stripe; check in Stripe that it's `inactive`. The customer is told by email and in the app, and the lock is in the audit log with your email.
3. Operators can't unlock. The customer unlocks in Settings with their passkey once they've secured their sign-in methods. If they can't, help them recover their Privy sign-in; don't look for a way around the lock.

## Customer data and closing accounts

Customers download their own data in Settings → Data and privacy (`GET /api/privacy/export`): every exportable table from `lib/privacy/subject-data.ts`, each with the reason it is kept. Nothing needs an operator.

Aura doesn't delete a customer's records on request. To close an account:

1. The customer asks in the support chat (Settings → Close your account opens Support, where "Ask to close" starts a prefilled Intercom conversation).
2. Confirm it's them in that conversation: Intercom shows the verified Aura user ID (from the Messenger identity token), never trust a claim made in a new channel.
3. In the operations app → Customers, search by Privy user ID, email, wallet address, or Aura tag. The console shows each balance and why the account can't be closed yet: funds left, a balance that couldn't be read, or a transaction in progress. Ask the customer to move the rest out.
4. When it's empty, press Close account and give the Intercom conversation link as the reason. The server checks again, closes it, locks it, unpublishes the Aura tag, and records it in the audit log.
5. A closed account can still download its data and contact support. If money arrives later, or the customer comes back, reopen it with a reason; it stays locked until they unlock it with their passkey.

Other rights, such as correcting data, go through support. Answer within the legal deadline for the customer's country, and record what was kept and why.

## Testing provider events in development

Point a Bridge sandbox webhook, Privy's test events, or a Stripe test-mode webhook at the dev Worker's `/api/webhooks/bridge`, `/api/webhooks/privy`, or `/api/webhooks/stripe`, with that provider's sandbox key or secret set on the dev environment. Bridge and Privy events resolve to customers through `provider_customer_links`; Stripe card events through `card_account_projections`. See [provider projections](../architecture/provider-projections.md). Remove test rows afterwards.

## Security escalation

- Freeze or restrict through the authoritative provider first when the contractual program supports it. For a card, that is Stripe: the customer's **Freeze card**, locking the account in Settings, or an operator lock in the operations app (both also try to freeze the card). Check in Stripe that the card is `inactive`, since the lock's freeze is best effort.
- Preserve trace IDs, provider object IDs, chain transaction hashes, timestamps, and consent versions.
- Never copy full KYC documents, seed phrases, private keys, or unredacted card data into tickets, logs, D1, or chat systems.
- Treat a provider outage as a degraded dependency, not permission to bypass controls.

## Recovery exercise record

The release drill for 21 September 2026 verified the recovery design without touching customer assets:

1. Applied the complete D1 migration set to a clean disposable database namespace.
2. Rebuilt the deterministic provider projection from source adapters and verified position provenance.
3. Exercised duplicate webhook detection, invalid signatures, policy denial, and provider failure states in automated tests.
4. Verified authenticated activity is derived from replaceable evidence while live balances come directly from Base RPC reads.
5. Verified the operations reconciliation surface denies access unless a Privy subject is explicitly allowlisted.
6. Confirmed no automated test or recovery step signs or broadcasts a value-moving transaction.

The Privy allowlist in step 5 was replaced by Cloudflare Access on 28 September 2026; when you repeat the drill, check instead that the operator APIs refuse a request without a verified Access token.

Repeat this drill before enabling a regulated provider, after any persistence-schema change, and at least quarterly once real customer workflows are active. Record the date, operator, database target, discrepancies, and remediation in the incident system; never place customer secrets or raw KYC evidence in the record.
