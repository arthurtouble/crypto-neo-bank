# Approval-Only Transfer Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce idempotent due reminders for wallet transfer schedules and open the existing direct-send review; never execute a transfer from a timer or occurrence endpoint.

**Architecture:** Store an IANA timezone and local wall-clock anchor on each new schedule. A pure recurrence module computes one-time, weekly, and monthly occurrences with deterministic daylight-saving rules. Authenticated reads materialize due occurrences with a unique schedule/due-time key; a separate authenticated review action rechecks the schedule, recipient cooling, account lock, beta access, and transfer feature flag before returning a direct-send review URL. The existing send flow remains the sole transaction path and repeats financial policy, preparation, simulation, and wallet confirmation.

**Tech Stack:** Next.js route handlers, D1/SQLite, TypeScript, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-aurel-product-parity-design.md` (program 7 and shared safety rules).

## Global Constraints

- D1 stores instructions and reminder state, never balances or settlement authority.
- No cron, server route, or occurrence code signs or sends a transaction.
- Bank schedules remain `setup_required`; no provider mandate is inferred.
- Existing legacy schedules without local recurrence metadata are not silently upgraded.
- Account lock, beta eligibility, feature flag, recipient ownership/cooling, and financial policy remain required before actual send.
- No deployment, commit, KB edit, or portfolio/chart edit in this tranche.

## Review Focus

- Nonexistent spring-forward wall time moves to the first valid local minute; ambiguous fall-back wall time chooses the earlier instant.
- Monthly 29/30/31 anchors clamp to the last day of a short month without permanently shifting the anchor.
- Repeated due reads and concurrent requests never create duplicate occurrences.
- Pause/cancel prevents review even if an occurrence was already materialized.
- Review links never bypass direct-send amount entry, policy evaluation, simulation, or wallet confirmation.

---

### Task 1: Recurrence and durable occurrence schema

**Files:** Create `infra/d1/migrations/0018_transfer_schedule_occurrences.sql`, `apps/web/src/lib/schedules/recurrence.ts`, `apps/web/tests/unit/transfer-schedule-recurrence.test.ts`.

**Interfaces:** `nextOccurrence({scheduleType, timeZone, anchorLocal, after}): Date | null` computes the next strictly later UTC instant. `anchorLocal` is `YYYY-MM-DDTHH:mm` and `timeZone` is an IANA zone. `schedule_occurrences` has unique `(schedule_id, due_at)` and a reminder/review state; no transaction hash column.

- [ ] Write tests first for one-time termination, weekly local-clock preservation, month-end clamping, spring gap, fall overlap, invalid zone/local date.
- [ ] Run focused Vitest and observe failures caused by absent recurrence implementation.
- [ ] Implement migration and pure recurrence logic; run focused tests to green. Validate the migration with SQLite.

### Task 2: Authenticated due and review API

**Files:** Modify `apps/web/src/app/api/transfer-schedules/route.ts`; create `apps/web/src/app/api/transfer-schedules/due/route.ts`, `apps/web/tests/unit/transfer-schedule-route.test.ts`.

**Interfaces:** Schedule POST accepts `timeZone` and `anchorLocal`; GET returns them. Due GET returns active due occurrences, materializing at most one overdue occurrence per schedule per read with `INSERT OR IGNORE` and conditional next-run update. Due POST takes `{occurrenceId}` and returns `{reviewUrl}` only after current security rechecks; it cannot mark transfer paid or submit a transaction.

- [ ] Write route tests first for auth, schedule creation metadata, repeated due reads, recipient cooling, locked account, paused/cancelled race, and link content.
- [ ] Run focused route tests red, implement scoped SQL and guards, then run green.
- [ ] Preserve existing provider-managed rows and bank setup-required behavior.

### Task 3: Schedule workspace reminder UI

**Files:** Modify `apps/web/src/components/recipient-schedule-workspace.tsx`, `apps/web/src/app/product-system.css`; create `apps/web/tests/unit/transfer-schedule-workspace.test.ts` and add a desktop/mobile E2E assertion to `apps/web/tests/e2e/product.spec.ts` if the browser harness is available.

**Interfaces:** New schedules send browser timezone and literal `datetime-local` wall time. Due cards show amount, destination, local due time, reminder state, and `Review transfer` button; the button calls due POST then opens its returned direct-send URL. Pause/cancel are accessible and refresh both schedule and due queries.

- [ ] Write failing UI tests for due/paused/cancelled copy and review navigation without wallet execution.
- [ ] Run red, implement the UI, and run green.
- [ ] Run full web unit suite, typecheck, lint, diff check, and focused browser test if possible; record any environment blocker.
