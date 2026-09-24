import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

const noStore = { "Cache-Control": "no-store" };
const cancel = z.object({ scheduleId: z.string().uuid(), action: z.literal("cancel") });
type ScheduleRow = { schedule_id: string; schedule_type: string; destination_kind: string; destination_reference: string; destination_label: string; rail: string | null; asset: string; amount: string; next_run_at: string; status: string; provider: string | null; time_zone: string | null; anchor_local: string | null; created_at: string; updated_at: string };

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const rows = await env.PROJECTION_DB.prepare(`SELECT schedule_id, schedule_type, destination_kind, destination_reference, destination_label, rail, asset, amount, next_run_at, status, provider, time_zone, anchor_local, created_at, updated_at
      FROM transfer_schedules WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(subject.subjectReference).all<ScheduleRow>();
    return Response.json({ schedules: rows.results.map((row) => ({ scheduleId: row.schedule_id, scheduleType: row.schedule_type, destinationKind: row.destination_kind, destinationReference: row.destination_reference, destinationLabel: row.destination_label, rail: row.rail, asset: row.asset, amount: row.amount, nextRunAt: row.next_run_at, status: row.status, provider: row.provider, timeZone: row.time_zone, anchorLocal: row.anchor_local, createdAt: row.created_at, updatedAt: row.updated_at })), authority: "Historical approval plans; providers and chains remain authoritative", traceId }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401, headers: noStore });
    return Response.json({ error: "schedules_unavailable", traceId }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireVerifiedSubject(request);
    return Response.json({ error: "schedules_retired", traceId }, { status: 410, headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401, headers: noStore });
    return Response.json({ error: "schedules_unavailable", traceId }, { status: 503, headers: noStore });
  }
}

export async function PATCH(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const input = cancel.parse(await request.json());
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    const [updated] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`UPDATE transfer_schedules SET status = 'cancelled', updated_at = ?
        WHERE schedule_id = ? AND subject_reference = ? AND status IN ('approval_required', 'paused') AND provider IS NULL`)
        .bind(now, input.scheduleId, subject.subjectReference),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
        SELECT ?, ?, 'customer', ?, 'transfer.schedule.cancel', 'transfer_schedule', ?, '{}', ? WHERE changes() = 1`)
        .bind(auditId, subject.subjectReference, subject.subjectReference, input.scheduleId, now),
      env.PROJECTION_DB.prepare(`UPDATE schedule_occurrences SET reminder_state = 'dismissed'
        WHERE schedule_id = ? AND subject_reference = ? AND reminder_state != 'dismissed'
          AND EXISTS (SELECT 1 FROM audit_events WHERE audit_id = ?)`)
        .bind(input.scheduleId, subject.subjectReference, auditId)
    ]);
    if (!updated.meta.changes) return Response.json({ error: "schedule_not_cancellable", traceId }, { status: 409, headers: noStore });
    return Response.json({ updated: true, status: "cancelled", traceId }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401, headers: noStore });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_schedule_update", traceId }, { status: 400, headers: noStore });
    return Response.json({ error: "schedule_update_unavailable", traceId }, { status: 503, headers: noStore });
  }
}
