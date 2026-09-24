import { nextOccurrence, type ScheduleType } from "@/lib/schedules/recurrence";
import { dueSwapReminders } from "@/lib/swap/reminder-decisions";
import { parseAssetId } from "@/lib/swap/assets";

export type ReminderInput = { fromAssetId: string; toAssetId: string; amount: string; scheduleType: ScheduleType; timeZone: string; anchorLocal: string };
export type ReminderChange = { planId: string; version: number; action: "pause" | "resume" | "cancel" | "edit" } & Partial<ReminderInput>;
export type ReminderPlan = ReminderInput & { planId: string; planVersion: number; status: "active" | "paused" | "cancelled"; nextDueAt: string | null };
export type DueReminder = { occurrenceId: string; planId: string; planVersion: number; dueAt: string; fromAssetId: string; toAssetId: string; amount: string; reminderState: string };
export type ReminderWriteAccess = { mode: "preview" | "invite"; countryCode: string | null; allowedCountries: string[] };
export class ReminderAccessChangedError extends Error {}
type PlanRow = { plan_id: string; subject_reference: string; base_asset_id: string; quote_asset_id: string; amount_decimal: string; schedule_type: ScheduleType; time_zone: string; anchor_local: string; status: "active" | "paused" | "cancelled"; next_due_at: string | null; plan_version: number };
type DueRow = { occurrence_id: string; plan_id: string; plan_version: number; due_at: string; base_asset_id: string; quote_asset_id: string; amount_decimal: string; reminder_state: string };
const MAPPING_VERSION = "reviewed-swap-catalog-v1";

function present(row: PlanRow): ReminderPlan {
  return { planId: row.plan_id, planVersion: row.plan_version, status: row.status, fromAssetId: row.base_asset_id, toAssetId: row.quote_asset_id, amount: row.amount_decimal, scheduleType: row.schedule_type, timeZone: row.time_zone, anchorLocal: row.anchor_local, nextDueAt: row.next_due_at };
}

export async function listSwapReminderPlans(db: D1Database, subjectReference: string): Promise<ReminderPlan[]> {
  const rows = await db.prepare("SELECT * FROM swap_reminder_plans WHERE subject_reference = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 100").bind(subjectReference).all<PlanRow>();
  return rows.results.map(present);
}

export async function createSwapReminderPlan(db: D1Database, subjectReference: string, input: ReminderInput, access: ReminderWriteAccess, now = new Date()): Promise<ReminderPlan> {
  const next = nextOccurrence({ scheduleType: input.scheduleType, timeZone: input.timeZone, anchorLocal: input.anchorLocal, after: now });
  if (!next) throw new Error("The reminder time has elapsed.");
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  const crossChain = parseAssetId(input.fromAssetId)?.chainId !== parseAssetId(input.toAssetId)?.chainId;
  const [inserted] = await db.batch([
    db.prepare(`INSERT INTO swap_reminder_plans
      (plan_id, subject_reference, pair_id, base_asset_id, quote_asset_id, quote_currency, mapping_version, amount_decimal, schedule_type, time_zone, anchor_local, next_due_at, status, plan_version, created_at, updated_at)
      SELECT ?, s.subject_reference, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?
      FROM subject_profiles s WHERE s.subject_reference = ?
        AND EXISTS (SELECT 1 FROM security_profiles p WHERE p.subject_reference = s.subject_reference AND p.account_locked = 0)
        AND EXISTS (SELECT 1 FROM feature_flags f WHERE f.flag_key = 'swaps' AND f.enabled = 1 AND f.audience IN ('all', 'beta'))
        AND (? = 0 OR EXISTS (SELECT 1 FROM feature_flags f WHERE f.flag_key = 'cross_chain' AND f.enabled = 1 AND f.audience IN ('all', 'beta')))
        AND (? = 'preview' OR EXISTS (SELECT 1 FROM beta_access b WHERE b.subject_reference = s.subject_reference
          AND b.status = 'active' AND b.country_code = ? AND b.country_code IN (SELECT value FROM json_each(?))))`)
      .bind(id, `${input.fromAssetId}/${input.toAssetId}`, input.fromAssetId, input.toAssetId, MAPPING_VERSION, input.amount, input.scheduleType, input.timeZone, input.anchorLocal, next.toISOString(), timestamp, timestamp,
        subjectReference, Number(crossChain), access.mode, access.countryCode, JSON.stringify(access.allowedCountries)),
    db.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      SELECT ?, ?, 'customer', ?, 'swap.reminder.created', 'swap_reminder_plan', ?, ?, ? WHERE changes() = 1`)
      .bind(crypto.randomUUID(), subjectReference, subjectReference, id, JSON.stringify({ scheduleType: input.scheduleType, version: 1 }), timestamp)
  ]);
  if (inserted.meta.changes !== 1) throw new ReminderAccessChangedError("Reminder access changed before creation.");
  return { ...input, planId: id, planVersion: 1, status: "active", nextDueAt: next.toISOString() };
}

export async function changeSwapReminderPlan(db: D1Database, subjectReference: string, change: ReminderChange, access: ReminderWriteAccess | null, now = new Date()): Promise<boolean> {
  const row = await db.prepare("SELECT * FROM swap_reminder_plans WHERE plan_id = ? AND subject_reference = ?").bind(change.planId, subjectReference).first<PlanRow>();
  if (!row || row.plan_version !== change.version || row.status === "cancelled") return false;
  if (change.action === "pause" && row.status !== "active" || change.action === "resume" && row.status !== "paused" || change.action === "edit" && row.status !== "active") return false;
  const status = change.action === "pause" ? "paused" : change.action === "cancel" ? "cancelled" : "active";
  const input: ReminderInput = change.action === "edit"
    ? { fromAssetId: change.fromAssetId ?? row.base_asset_id, toAssetId: change.toAssetId ?? row.quote_asset_id, amount: change.amount ?? row.amount_decimal, scheduleType: change.scheduleType ?? row.schedule_type, timeZone: change.timeZone ?? row.time_zone, anchorLocal: change.anchorLocal ?? row.anchor_local }
    : { fromAssetId: row.base_asset_id, toAssetId: row.quote_asset_id, amount: row.amount_decimal, scheduleType: row.schedule_type, timeZone: row.time_zone, anchorLocal: row.anchor_local };
  const next = status === "active" ? nextOccurrence({ scheduleType: input.scheduleType, timeZone: input.timeZone, anchorLocal: input.anchorLocal, after: now }) : null;
  if (status === "active" && !next) return false;
  if (status === "active" && !access) return false;
  const crossChain = parseAssetId(input.fromAssetId)?.chainId !== parseAssetId(input.toAssetId)?.chainId;
  const auditId = crypto.randomUUID();
  const [updated] = await db.batch([
    db.prepare(`UPDATE swap_reminder_plans SET pair_id = ?, base_asset_id = ?, quote_asset_id = ?, amount_decimal = ?, schedule_type = ?, time_zone = ?, anchor_local = ?, next_due_at = ?, status = ?, plan_version = plan_version + 1, updated_at = ?
      WHERE plan_id = ? AND subject_reference = ? AND plan_version = ? AND status = ?
        AND (? = 0 OR (EXISTS (SELECT 1 FROM security_profiles p WHERE p.subject_reference = swap_reminder_plans.subject_reference AND p.account_locked = 0)
          AND EXISTS (SELECT 1 FROM feature_flags f WHERE f.flag_key = 'swaps' AND f.enabled = 1 AND f.audience IN ('all', 'beta'))
          AND (? = 0 OR EXISTS (SELECT 1 FROM feature_flags f WHERE f.flag_key = 'cross_chain' AND f.enabled = 1 AND f.audience IN ('all', 'beta')))
          AND (? = 'preview' OR EXISTS (SELECT 1 FROM beta_access b WHERE b.subject_reference = swap_reminder_plans.subject_reference
            AND b.status = 'active' AND b.country_code = ? AND b.country_code IN (SELECT value FROM json_each(?))))))`)
      .bind(`${input.fromAssetId}/${input.toAssetId}`, input.fromAssetId, input.toAssetId, input.amount, input.scheduleType, input.timeZone, input.anchorLocal, next?.toISOString() ?? null, status, now.toISOString(), change.planId, subjectReference, change.version, row.status,
        Number(status === "active"), Number(crossChain), access?.mode ?? "invite", access?.countryCode ?? null, JSON.stringify(access?.allowedCountries ?? [])),
    db.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      SELECT ?, ?, 'customer', ?, ?, 'swap_reminder_plan', ?, ?, ? WHERE changes() = 1`)
      .bind(auditId, subjectReference, subjectReference, `swap.reminder.${change.action}`, change.planId, JSON.stringify({ priorVersion: change.version }), now.toISOString()),
    db.prepare(`UPDATE swap_reminder_occurrences SET reminder_state = 'superseded', updated_at = ?
      WHERE plan_id = ? AND subject_reference = ? AND plan_version = ? AND reminder_state = 'due'
        AND EXISTS (SELECT 1 FROM audit_events WHERE audit_id = ?)`)
      .bind(now.toISOString(), change.planId, subjectReference, change.version, auditId)
  ]);
  return updated.meta.changes === 1;
}

function presentDue(row: DueRow): DueReminder {
  return { occurrenceId: row.occurrence_id, planId: row.plan_id, planVersion: row.plan_version, dueAt: row.due_at, fromAssetId: row.base_asset_id, toAssetId: row.quote_asset_id, amount: row.amount_decimal, reminderState: row.reminder_state };
}

/** Idempotent in-app reminder evaluation. No wallet or quote dependency. */
export async function materializeDueSwapReminders(db: D1Database, subjectReference: string, now = new Date()): Promise<DueReminder[]> {
  await db.prepare("UPDATE swap_reminder_occurrences SET reminder_state = 'expired', updated_at = ? WHERE subject_reference = ? AND kind = 'plan' AND reminder_state = 'due' AND due_at < ?")
    .bind(now.toISOString(), subjectReference, new Date(now.getTime() - 86_400_000).toISOString()).run();
  const candidates = await db.prepare(`SELECT * FROM swap_reminder_plans WHERE subject_reference = ? AND status = 'active' AND next_due_at <= ? ORDER BY next_due_at LIMIT 50`)
    .bind(subjectReference, now.toISOString()).all<PlanRow>();
  for (const plan of candidates.results) {
    if (!plan.next_due_at) continue;
    const decision = dueSwapReminders({ scheduleType: plan.schedule_type, timeZone: plan.time_zone, anchorLocal: plan.anchor_local, status: plan.status }, new Date(Date.parse(plan.next_due_at) - 1), now);
    const due = decision.due.find((item) => item.toISOString() === plan.next_due_at);
    const nextDueAt = nextOccurrence({ scheduleType: plan.schedule_type, timeZone: plan.time_zone, anchorLocal: plan.anchor_local, after: now });
    if (due) {
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO swap_reminder_occurrences (occurrence_id, subject_reference, kind, plan_id, plan_version, due_at, created_at)
          SELECT ?, subject_reference, 'plan', plan_id, plan_version, next_due_at, ? FROM swap_reminder_plans
          WHERE plan_id = ? AND subject_reference = ? AND status = 'active' AND plan_version = ? AND next_due_at = ?`)
          .bind(crypto.randomUUID(), now.toISOString(), plan.plan_id, subjectReference, plan.plan_version, plan.next_due_at),
        db.prepare(`UPDATE swap_reminder_plans SET next_due_at = ?, updated_at = ? WHERE plan_id = ? AND subject_reference = ? AND status = 'active' AND plan_version = ? AND next_due_at = ?`)
          .bind(nextDueAt?.toISOString() ?? null, now.toISOString(), plan.plan_id, subjectReference, plan.plan_version, plan.next_due_at)
      ]);
    } else {
      await db.prepare(`UPDATE swap_reminder_plans SET next_due_at = ?, updated_at = ? WHERE plan_id = ? AND subject_reference = ? AND status = 'active' AND plan_version = ? AND next_due_at = ?`)
        .bind(nextDueAt?.toISOString() ?? null, now.toISOString(), plan.plan_id, subjectReference, plan.plan_version, plan.next_due_at).run();
    }
  }
  const rows = await db.prepare(`SELECT o.occurrence_id, o.plan_id, o.plan_version, o.due_at, p.base_asset_id, p.quote_asset_id, p.amount_decimal, o.reminder_state
    FROM swap_reminder_occurrences o JOIN swap_reminder_plans p ON p.plan_id = o.plan_id AND p.subject_reference = o.subject_reference
    WHERE o.subject_reference = ? AND p.subject_reference = ? AND o.kind = 'plan' AND o.reminder_state = 'due' AND p.status = 'active' AND o.plan_version = p.plan_version
    ORDER BY o.due_at DESC LIMIT 50`).bind(subjectReference, subjectReference).all<DueRow>();
  return rows.results.map(presentDue);
}
