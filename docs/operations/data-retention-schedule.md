---
title: Data retention and deletion schedule
description: Internal retention, deletion, and recovery rules by data category.
---

Status: pre-launch baseline. Counsel and each regulated provider must approve the final periods before customer onboarding. Aura doesn't keep data just because storage is available.

| Record | Purpose | Baseline period | Authority and deletion rule |
|---|---|---:|---|
| Wallet addresses and provider references | Connect the customer to authoritative systems | Active relationship + 7 years | Delete or irreversibly detach after legal, complaint, fraud and tax holds expire |
| Actions and action events (`actions`, `action_events`) | Explain and investigate customer money movements | 7 years | Preserve hashes and decision evidence; never store signing secrets |
| Consent and disclosure evidence | Prove the version and action accepted | 7 years after relationship | Legal hold overrides scheduled deletion |
| Security preferences and destination book | Enforce customer controls | Active relationship + 90 days | Delete after closure unless linked to an incident or complaint |
| Route quotes (`route_quotes`) | Price and bind a route the customer may sign | Until expiry + 1 day, unless used by an action | Deleted after expiry (on the next quote, and by the hourly cleanup); a used quote follows its action |
| Provider webhook receipts (`webhook_receipts`) | Retry, reconcile and investigate events | 2 years once processed | Retain identifiers and hashes, never raw payloads. Received, queued and failed receipts stay until an operator resolves them |
| Support chats and complaints (in Intercom) | Respond and evidence handling | 7 years | Redact accidental secrets immediately; provider-specific rules may be longer |
| Product analytics (`product_events`) | Improve activation and reliability | 180 days | Deleted by the hourly cleanup. No aggregates are kept yet; any added later must carry no subject reference |
| Notices (`notifications`) | Show the customer what happened; deliver it by email and push | 180 days once delivered or failed | Deleted by the hourly cleanup; a notice still pending on either channel stays |
| Browser push subscriptions (`push_subscriptions`) | Deliver browser notifications | Until the customer turns them off, a newer browser replaces it, or the push service says it's gone | Not on a timer, see below |
| Abuse and rate-limit windows (`rate_limit_windows`) | Protect the service | 24 hours after window | Automatically delete expired counters |
| Passkey confirmations (`step_up_challenges`) | Confirm a sensitive change | 1 day after expiry (they last 5 minutes) | The change itself is in `audit_events` |
| Provider command claims (`command_idempotency`) | Stop a retried request sending a provider command twice | 30 days after the claim expires | An expired claim can already be taken again, so deleting it changes nothing |
| Application logs and traces | Reliability and security investigation | 30 days hot; up to 1 year security archive | No keys, tokens, recovery material or full identity documents |
| KYC source documents | Regulated onboarding | Not stored by Aura by design | Remain with the contracted regulated provider |
| Incident records | Security, customer impact and remediation | 7 years | Public notices remain; internal evidence follows access and legal-hold rules |

## Scheduled cleanup

`purgeExpired` (`apps/web/src/lib/privacy/retention.ts`) runs from the web Worker's cron at the top of each hour. It deletes at most 500 rows per table per run, so a run stays short and a backlog clears over later runs, and logs one `retention.purge.completed` line with the count per table ([monitoring](monitoring.md)). The events Worker's reconciliation also clears rate-limit counters. Periods are deliberately conservative; shortening one is a reviewed change to that file, this table, and its tests.

| Table | Deleted when | Why it is safe |
| --- | --- | --- |
| `product_events` | `occurred_at` is over 180 days old | Analytics only. The operations app reads 90 days at most. |
| `notifications` | `created_at` is over 180 days old and neither email nor push is `pending` | A notice's `dedupe_key` stops the same event notifying twice, so it must outlive any chance of seeing the event again. Money received is announced only if it arrived in the last 90 days (`RECEIVED_NOTICE_WINDOW_DAYS`), so a deleted received notice can't come back. Action and bank-payout notices fire once on a forward status change; card notices fire only on a new webhook receipt, which is kept 2 years. A notice still being delivered is never deleted. |
| `step_up_challenges` | `expires_at` is over 1 day ago | A confirmation is refused after expiry anyway. |
| `rate_limit_windows` | `reset_at` is over 1 day ago | An expired counter starts again from 1 whether its row exists or not. |
| `route_quotes` | unused (`action_id` is null), `expires_at` over 1 day ago, and no action has it as `route_quote_id` | An expired quote can't be used. The extra check covers an action recorded just before its quote was marked used. |
| `command_idempotency` | `expires_at` is over 30 days ago | An expired claim can be taken again, so a missing row behaves the same. |
| `webhook_receipts` | `processing_status = 'processed'` and `received_at` over 2 years ago | Providers retry for days, not years (Stripe for up to 3 days, Privy through Svix for about a day; Bridge's window is to be confirmed with Bridge), so dedupe and the requeue of stuck `received` receipts still hold. Failed and unfinished receipts are kept for reconciliation. |

Kept on purpose, never deleted by the job:

- `actions` and `action_events`: transaction evidence. The schema refuses deletes.
- `consent_evidence`, `consent_events`, `audit_events`, `operational_issues`: legal, security and investigation records.
- `subject_profiles`, `security_profiles`, `address_book_entries`, `user_preferences`, `onboarding_progress`, `aura_tags`, `provider_customer_links`, the provider projections, `incoming_observations`, `card_observations`: account and projection records, kept for the relationship as in the table above.
- `incoming_watches`: one row per customer. Its `watched_since` is what stops past deposits being announced, and it stops being scanned 30 days after the customer was last active.
- `push_subscriptions`: removed when the customer turns notifications off, when a newer browser replaces it (10 at most), or when the push service answers 404 or 410. Not deleted for repeated failures: the app shows push as on from the browser's own subscription, so deleting it on the server would silently stop notifications after a push-service outage.
- `operational_checks`, `feature_flags`, `asset_pauses`: a few keyed rows, overwritten in place.

## Operating rules

1. A deletion job must use an approved record category, cutoff and legal-hold check.
2. Backups inherit the same retention intent and expire through the backup lifecycle rather than ad hoc editing.
3. A customer-rights request is logged, identity-verified, mapped across Aura and providers, and answered within the applicable legal period.
4. Public-chain data cannot be erased by Aura. Aura can remove its own association and explain the remaining public record.
5. Original KYC documents, card data, seed phrases, private keys and one-time codes are prohibited from D1, logs, support and analytics.
