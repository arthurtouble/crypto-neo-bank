---
title: Operations and recovery runbook
description: Routine operations, reconciliation, recovery, escalation, and evidence procedures.
---

## Operating premise

Losing D1 doesn't lose customer funds: Privy, contracted providers, and public chains are financially authoritative. D1 also holds Aura's security decisions, customer instructions, consent evidence, and audit history. These aren't a balance ledger, but they aren't disposable: retain and back them up per the approved policy.

## Daily controls

1. Review Queue backlog, retry counts, and the dead-letter queue.
2. Review webhook receipts left `received`, `enqueued`, or `failed` beyond the expected processing window.
3. Reconcile provider transfer and card states and onchain positions against the latest projection.
4. Escalate stale observations; never display them as current.
5. Review actions left `submitted` or `settling` (operations app → Money movement → Stuck only), and sample confirmed actions against their chain evidence.
6. Review notices whose email or push is `failed`, or still `pending` after several cron runs (`SELECT kind, email_status, push_status, delivery_attempts FROM notifications WHERE email_status IN ('pending','failed') OR push_status IN ('pending','failed')`). The cron logs `notifications.deliver.failed`; a run of Resend refusals usually means the sending domain or key changed.

## Webhook incident

1. Confirm signature rejection or schema failure from Worker logs by `traceId`.
2. Never disable signature or timestamp verification to restore traffic.
3. Confirm the provider’s active key or secret and signing format through an authenticated support channel. Each scheme and its secret is in [provider projections](../architecture/provider-projections.md#flow).
4. Rotate the Worker secret if exposure is suspected.
5. Replay provider events by their stable event IDs. Duplicates are safe: `webhook_receipts.event_id` is unique.
6. Rebuild affected projections from provider APIs or chains.

## Queue or consumer incident

1. Pause the consumer if downstream writes are corrupt or a provider dependency keeps failing.
2. Inspect retries and dead-letter messages; keep the original event ID.
3. Repair the consumer and replay into the normal Queue.
4. Verify `webhook_receipts.processing_status` and the resulting refresh record.
5. Reconcile the affected external object before resolving the incident.

## D1 loss or corruption

1. Create a replacement D1 database and apply every migration.
2. Reattach the binding to both Workers.
3. Restore the latest verified evidence backup before accepting new customer instructions.
4. Query provider APIs and chains directly.
5. Rebuild wallet, fiat, card, and position projections with source metadata.
6. Re-run reconciliation. Balances must match authoritative systems independently of the D1 restore.
7. Treat any gap in consent, security-policy, case, or administrative audit evidence as an incident. Never invent or infer missing acceptance.

### Recovery drill

The drill of 21 September 2026 verified this design without touching customer assets. Repeat it before enabling a regulated provider, after any persistence-schema change, and at least quarterly once real customer workflows are active:

1. Apply every D1 migration to a clean, disposable database.
2. Rebuild the deterministic provider projection from source adapters and verify position provenance.
3. Exercise duplicate webhooks, invalid signatures, policy denial, and provider failures in automated tests.
4. Verify authenticated activity comes from replaceable evidence, and live balances directly from Base RPC reads.
5. Verify the operator APIs refuse a request without a verified Cloudflare Access token. (In the 2026 drill this was a Privy allowlist, replaced by Access on 28 September 2026.)
6. Confirm no automated test or recovery step signs or broadcasts a value-moving transaction.

Record the date, operator, database target, discrepancies, and remediation in the incident system. Never put customer secrets or raw KYC evidence in the record.

## Production release

For the first launch, follow [production launch](production-launch.md) first.

1. Run `pnpm production:check`, then `pnpm lint`, `pnpm typecheck:all`, `pnpm test:unit`, `pnpm test:e2e`, and `pnpm deploy:dry-run`.
2. Apply pending D1 migrations before code that needs the new schema. Per environment:
   - The operations app needs its Worker deployed (`aurel-ops`, or `aura-dev-ops` with `pnpm ops:deploy:dev`), Cloudflare Access in front of it, and the web app's `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` set ([edge security activation](edge-security-activation.md#cloudflare-access)). Until then every operator request is refused.
   - Notifications need a Resend domain verified for `EMAIL_FROM`, the `RESEND_API_KEY` secret (a send-only key), `APP_ORIGIN`, and a VAPID key pair for that environment (`VAPID_PUBLIC_KEY` as a variable, `VAPID_PRIVATE_KEY` as a secret). Without them, email or push is skipped; in-app notices still work.
3. Run `pnpm release:upload` to create an undeployed candidate, and smoke test its preview URL.
4. On a custom domain, configure version affinity before splitting traffic, so a session gets consistent code and static assets.
5. Deploy the candidate to a small share first with `wrangler versions deploy <old>@95 <candidate>@5`, watch errors and key journeys, then promote deliberately.
6. Stop the rollout and run `pnpm release:rollback` if authentication, customer controls, action preparation or verification, asset reads, or support intake regress.
7. A code rollback doesn't roll back D1. Database changes must stay backward-compatible through the rollout window.

## Service targets

- Availability: 99.95%, excluding upstream chain or provider incidents shown as degraded dependencies.
- Route preparation success: at least 98% when a provider route is available.
- Traceability: 100% of actions have an action ID and, after signing, a transaction hash.
- Stale actions: open an issue after 15 minutes `submitted` without a receipt, or 2 hours `settling` without delivery.
- Urgent security or funds-at-risk case: acknowledged within 15 minutes during published coverage.
- Normal case: first response within one business day.

## Command ambiguity

If Aura times out after sending a command:

1. Don't submit a second command with a new idempotency key.
2. Query the provider with the original key or provider object reference.
3. Show “status unknown—checking provider,” never “failed,” until the authoritative status is known.
4. Reconcile the provider object before allowing a retry.

## Operations app

Operators work in the operations app (`apps/ops`), a separate Worker behind Cloudflare Access. Sign in through Access with your own email; there is no shared account. The web app checks your Access token on every request and records your email on every change. See [architecture](../architecture/architecture.md#operations-app).

- **Customers:** every customer, newest first, 50 at a time with **Load more**; or find one by Privy user ID, email, wallet address, or Aura tag. Shows their controls, Aura tag, Bridge status, card, action counts, whether the account can be closed, their Intercom user ID, and their 10 latest notices with how each email and push went. A failed email (refused or bounced by their mail server, as Resend reported) is flagged with a count, so support knows to check the app instead. Lock, close, or reopen, each with a reason.
- **Money movement:** from a customer, everything on their account as they see it in Transactions, including money from outside Aura and card payments; a source that can't be read says so. Otherwise, everything moving on Aura: every customer's actions, money received from outside Aura (recorded within a few minutes of the chain showing it), and card payments, holds, declines, and refunds (recorded when Stripe reports them and each time the customer's card history is read), with **Received from outside Aura** and **Card payments** as kinds. Newest first, filtered by status, kind, customer, or stuck only (submitted over 15 minutes with no receipt, or settling over 2 hours). Open one to see its journey, or check an open action against the chain now (audited).
- **Stats:** customers, completed, failed, and stuck actions, volume by kind, the new-customer funnel, and a by-day table, for 7, 30, or 90 days. From D1 records only, so money that arrived without an Aura action isn't counted. Never use them as balances.
- **Controls:** feature switches, asset pauses (with a reason), and issues (stuck actions and failed provider events, to acknowledge or resolve), with provider event counts and checks.

### Locking an account to protect a customer

Lock an account when someone else seems to be using it, for example after a report in the support chat. Confirm the customer in the conversation first, as for closing below.

1. In Customers, find the account and press Lock account, with a reason such as the Intercom conversation link.
2. Sending stops at once, including prepared actions. Aura tries to freeze the card at Stripe; check in Stripe that it's `inactive`. The customer is told by email and in the app, and the lock is audited with your email.
3. Operators can't unlock. The customer unlocks in Settings with their passkey once their sign-in methods are secure. If they can't, help them recover their Privy sign-in; never look for a way around the lock.

## Customer data and closing accounts

Customers download their own data in Settings → Your data (`GET /api/privacy/export`): every exportable table in `lib/privacy/subject-data.ts`, each with the reason it's kept. No operator needed.

Aura doesn't delete a customer's records on request. To close an account:

1. The customer asks in the support chat (Settings → Close your account opens Support, where "Ask to close" starts a prefilled Intercom conversation).
2. Confirm it's them in that conversation: Intercom shows the verified Aura user ID (from the Messenger identity token). Never trust a claim made in a new channel.
3. In the operations app → Customers, search by Privy user ID, email, wallet address, or Aura tag. It shows each balance and why the account can't close yet: funds left, an unreadable balance, or a transaction in progress. Ask the customer to move the rest out.
4. When it's empty, press Close account with the Intercom conversation link as the reason. The server checks again, closes and locks the account, unpublishes the Aura tag, and audits it.
5. A closed account can still download its data and contact support. If money arrives later, or the customer returns, reopen it with a reason; it stays locked until they unlock it with their passkey.

Other rights, such as correction, go through support. Answer within the customer's country's legal deadline, and record what was kept and why.

## Testing provider events in development

Point a Bridge sandbox webhook, Privy's test events, or a Stripe test-mode webhook at the dev Worker's `/api/webhooks/bridge`, `/api/webhooks/privy`, or `/api/webhooks/stripe`, with that provider's sandbox key or secret set on the dev environment. Bridge and Privy events resolve to customers through `provider_customer_links`, Stripe card events through `card_account_projections` ([provider projections](../architecture/provider-projections.md)). Remove test rows afterwards.

## Security escalation

- Freeze or restrict through the authoritative provider first when the program supports it. For a card that's Stripe: the customer's **Freeze card**, their lock in Settings, or an operator lock (both locks also try to freeze the card). Check in Stripe that the card is `inactive`; the lock's freeze is best effort.
- Preserve trace IDs, provider object IDs, chain transaction hashes, timestamps, and consent versions.
- Never copy full KYC documents, seed phrases, private keys, or unredacted card data into tickets, logs, D1, or chat systems.
- A provider outage is a degraded dependency, not permission to bypass controls.
