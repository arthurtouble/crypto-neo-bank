# Price Alerts and Approval-Required Swap Reminders

> Implement against the approved [product-parity design](../specs/2026-09-22-aurel-product-parity-design.md). Use test-driven development and review each financial-authority boundary before enabling a customer action.

## Goal

Let a customer save a price alert or a recurring Swap instruction and return to a fresh Swap review when it is triggered or due. Neither a scheduled Worker nor an alert endpoint may sign, broadcast, reserve, or claim to have exchanged assets. The customer's wallet confirmation, current eligibility, exact quote, policy, step-up, simulation, and settlement verification remain in the Swap execution path.

## Authority model

- D1 owns the customer's instruction, trigger history, notification preference, and reminder state. It is not a price oracle, asset balance, order book, or settlement ledger.
- Price observations come from the independently attributed, timestamped market adapter. A missing, stale, unsupported, or ambiguous quote does not fire an alert.
- A recurring instruction is an amount and pair preference, not a standing wallet mandate. Each occurrence is a new review. A saved quote, approval, or past step-up never carries forward.
- A triggered alert is not a limit order or guaranteed execution price. The reminder must name the observed price and time; the live review may differ or be unavailable.
- Tokenized securities and ineligible assets remain ineligible even if a market data or routing source lists them.

## Task 1 — Durable schema and pure decisions

Create a backward-compatible D1 migration with subject-scoped `price_alerts`, `swap_reminder_plans`, and append-only/idempotent `swap_reminder_occurrences`. Use unique keys for `(plan_id, due_at)` and `(alert_id, threshold_version, crossing_observation_id)` or an equivalent deterministic trigger identity. Store canonical asset IDs (chain and contract/native marker), quote currency, direction, threshold in normalized decimal or integer units, status, IANA timezone, local recurrence anchor, created/updated/version fields, and last qualifying observation. Do not store a wallet signature or transaction hash in a reminder row.

Write failing unit tests for input validation, stale observations, crossed/not-crossed thresholds, repeated observation, noisy oscillation, unsupported asset, price precision, one-time/weekly/monthly recurrence, DST, concurrent insertion, pause/cancel, and subject isolation. Implement pure trigger and recurrence logic. A trigger should be edge-based (crossing), not every poll above or below a threshold; rearming and cooldown must be explicit.

## Task 2 — Authenticated instruction APIs

Add authenticated CRUD with beta, country, feature, rate-limit, and canonical catalog checks. Customers may list, create, pause, resume, and cancel only their own instructions. No request body may supply a trusted current price, balance, provider entitlement, or execution status. Mutations use conditional versions to avoid stale-tab overwrite. A schedule edit changes future occurrences only; already due reminders are dismissed or superseded explicitly. Audit creation and mutation without storing unnecessary personal data.

Create idempotent due evaluation using fresh market observations and bounded batches. Triggering may run on authenticated reads initially; a later Cloudflare Cron can call the same server-owned evaluator with an operator credential and no wallet power. A provider notification adapter may deliver a reminder only after its contract and consent are configured. Without one, in-app reminders still work, and UI must not claim an email or push was sent.

## Task 3 — Customer review path

Add an alerts/reminders view within the established Swap workspace, not a new primary navigation item. Include clear create/edit/pause/cancel controls, observed price/time, next due time, and accessible empty, stale, disabled, and error states. `Review Swap` resolves the saved canonical pair into a **new** live quote and opens the existing Swap review. If the pair is no longer quoteable or eligible, explain why and leave the occurrence pending/dismissible. Never treat opening review as an executed Swap.

Once the governed Swap execution flow exists, attach a reminder reference as non-authoritative metadata only. The server must repeat ownership, eligibility, policy, exact quote, step-up, simulation, and settlement checks; it must not reuse a previous prepared call.

## Task 4 — Verification and activation

Run focused and full unit tests, migration/recovery drill, typecheck, lint, web/docs builds, desktop/mobile Playwright (keyboard and reduced-motion), and a production-candidate read-only smoke. Review concurrent trigger/occurrence races and notification retries. Verify no timer or reminder endpoint imports wallet-signing APIs. Keep email/push delivery and automatic trading disabled until explicit consent/provider/mandate gates are met. Document the distinction between an alert, an approval-required reminder, and an actual order in customer docs and the release ledger.

