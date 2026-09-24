type PlanRow = { plan_id: string; base_asset_id: string; quote_asset_id: string; amount_decimal: string; schedule_type: string; time_zone: string; anchor_local: string; status: string; next_due_at: string | null; plan_version: number };

/** Historical plans remain readable after scheduled swaps were retired. */
export async function listSwapReminderPlans(db: D1Database, subjectReference: string) {
  const rows = await db.prepare("SELECT * FROM swap_reminder_plans WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 100")
    .bind(subjectReference).all<PlanRow>();
  return rows.results.map((row) => ({ planId: row.plan_id, planVersion: row.plan_version, status: row.status,
    fromAssetId: row.base_asset_id, toAssetId: row.quote_asset_id, amount: row.amount_decimal,
    scheduleType: row.schedule_type, timeZone: row.time_zone, anchorLocal: row.anchor_local, nextDueAt: row.next_due_at }));
}

export async function cancelSwapReminderPlan(db: D1Database, subjectReference: string, planId: string, version: number) {
  const now = new Date().toISOString(), auditId = crypto.randomUUID();
  const [updated] = await db.batch([
    db.prepare(`UPDATE swap_reminder_plans SET status = 'cancelled', next_due_at = NULL, plan_version = plan_version + 1, updated_at = ?
      WHERE plan_id = ? AND subject_reference = ? AND plan_version = ? AND status IN ('active', 'paused')`)
      .bind(now, planId, subjectReference, version),
    db.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      SELECT ?, ?, 'customer', ?, 'swap.reminder.cancel', 'swap_reminder_plan', ?, ?, ? WHERE changes() = 1`)
      .bind(auditId, subjectReference, subjectReference, planId, JSON.stringify({ priorVersion: version }), now),
    db.prepare(`UPDATE swap_reminder_occurrences SET reminder_state = 'superseded', updated_at = ?
      WHERE plan_id = ? AND subject_reference = ? AND reminder_state = 'due'
        AND EXISTS (SELECT 1 FROM audit_events WHERE audit_id = ?)`)
      .bind(now, planId, subjectReference, auditId)
  ]);
  return updated.meta.changes === 1;
}
