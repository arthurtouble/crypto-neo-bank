# Price Alerts and Approval-Required Swap Reminders

> Implement against the approved [product-parity design](../specs/2026-09-22-aurel-product-parity-design.md). Use test-driven development and review each financial-authority boundary before enabling a customer action.

## Goal

Let a customer save a price alert or a recurring Swap instruction and return to a fresh Swap review when it is triggered or due. Neither a scheduled Worker nor an alert endpoint may sign, broadcast, reserve, or claim to have exchanged assets. The customer's wallet confirmation, current eligibility, exact quote, policy, step-up, simulation, and settlement verification remain in the Swap execution path.

## Authority model

- D1 owns the customer's instruction, trigger history, notification preference, and reminder state. It is not a price oracle, asset balance, order book, or settlement ledger.
- Price observations must include the provider's actual observation time, stable market-pair ID, stable observation ID, quote currency, and a reviewed mapping to a canonical chain/contract asset. The current Kraken adapter labels the fetch time as `last_updated`; that is insufficient for firing an alert. A missing, stale, unsupported, ambiguous, depegged, or unmapped quote does not fire. Fetch time alone never resets source age.
- A recurring instruction is an amount and pair preference, not a standing wallet mandate. Each occurrence is a new review. A saved quote, approval, or past step-up never carries forward.
- A triggered alert is not a limit order or guaranteed execution price. The reminder must name the observed price and time; the live review may differ or be unavailable.
- Tokenized securities and ineligible assets remain ineligible even if a market data or routing source lists them.

## Task 1 — Durable schema and pure decisions

Create a backward-compatible D1 migration with subject-scoped `price_alerts`, `swap_reminder_plans`, and append-only/idempotent `swap_reminder_occurrences`. Use unique keys for `(plan_id, plan_version, due_at)` and `(alert_id, threshold_version, crossing_observation_id)` or an equivalent deterministic trigger identity. Store canonical asset IDs (chain and contract/native marker), reviewed market-pair mapping, quote currency, direction, threshold in normalized decimal or integer units, status, IANA timezone, local recurrence anchor, created/updated/version fields, and the last accepted ordered observation (source time plus stable ID), armed side, cooldown, and trigger version. Do not store a wallet signature or transaction hash in a reminder row.

Write failing unit tests for input validation, upstream-observed versus fetch time, stale/out-of-order observations, missing canonical mapping, crossed/not-crossed thresholds, initially already-past-threshold, missed polls, repeated observation, noisy oscillation, unsupported asset, price precision, one-time/weekly/monthly recurrence, DST, concurrent insertion, pause/cancel, and subject isolation. Implement pure trigger and recurrence logic. A trigger is edge-based, not every poll above or below a threshold. Atomically compare and advance the accepted observation cursor and armed state with the occurrence insertion; hysteresis, rearming, and cooldown must be explicit. Reuse existing recurrence semantics: spring gaps move to the first valid local minute, fall overlaps choose the earlier instant, and month-end clamps without shifting the anchor. Bound overdue catch-up and define when an old reminder expires.

## Task 2 — Authenticated instruction APIs

Add authenticated CRUD with beta, country, feature, account-lock, incident kill-switch, rate-limit, and canonical catalog checks. Customers may list, create, pause, resume, and cancel only their own instructions. When locked, existing reminders may remain visible but cannot open a money-movement review. No request body may supply a trusted current price, balance, provider entitlement, or execution status. Mutations use conditional versions to avoid stale-tab overwrite. A schedule edit atomically increments its version and affects future occurrences only; a due instant belongs to exactly one committed version. Already due reminders are dismissed or superseded explicitly, and pause/cancel wins against a concurrent review or materialization. Audit creation and mutation without storing unnecessary personal data.

Create idempotent due evaluation using fresh market observations and bounded batches with a fair cursor. Triggering may run on authenticated reads initially, so the UI must say alerts are checked when Aurel is open and cannot promise immediate delivery. A later Cloudflare Cron may call a separately authorized, narrowly scoped server evaluator with no wallet power; never let a customer route enumerate other subjects. A provider notification adapter may deliver a reminder only after its contract and per-channel consent are configured. Use a durable outbox with a send idempotency key, provider message ID, claim/attempt state, bounded retries, and a fresh consent plus pause/cancel check before each attempt. Without a provider, in-app reminders still work, and UI must not claim an email or push was sent.

## Task 3 — Customer review path

Add an alerts/reminders view within the established Swap workspace, not a new primary navigation item. Include clear create/edit/pause/cancel controls, observed price/time, next due time, and accessible empty, stale, disabled, and error states. `Review Swap` resolves the saved canonical pair into a **new** live quote and opens the existing Swap review. While governed Swap signing is disabled, that review is visibly read-only and cannot expose an enabled transaction CTA. If the pair is no longer quoteable or eligible, explain why and leave the occurrence pending/dismissible. Never treat opening review as an executed Swap.

Once the governed Swap execution flow exists, attach a reminder reference as non-authoritative metadata only. The server must repeat ownership, eligibility, policy, exact quote, step-up, simulation, and settlement checks; it must not reuse a previous prepared call.

## Task 4 — Verification and activation

Run focused and full unit tests, migration/recovery drill, typecheck, lint, web/docs builds, desktop/mobile Playwright (keyboard and reduced-motion), and a production-candidate read-only smoke. Review concurrent trigger/occurrence races and notification retries. Verify no timer or reminder endpoint imports wallet-signing APIs. Keep email/push delivery and automatic trading disabled until explicit consent/provider/mandate gates are met. Document the distinction between an alert, an approval-required reminder, and an actual order in customer docs and the release ledger.
