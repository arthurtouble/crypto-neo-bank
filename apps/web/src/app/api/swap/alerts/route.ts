import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

const noStore = { "Cache-Control": "no-store" };
const cancel = z.strictObject({ alertId: z.string().uuid(), version: z.number().int().positive(), action: z.literal("cancel") });
type AlertRow = { alert_id: string; pair_id: string; direction: string; threshold_decimal: string; status: string; threshold_version: number; created_at: string; updated_at: string };

export async function GET(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const rows = await env.PROJECTION_DB.prepare(`SELECT alert_id, pair_id, direction, threshold_decimal, status, threshold_version, created_at, updated_at
      FROM price_alerts WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(subject.subjectReference).all<AlertRow>();
    return Response.json({ alerts: rows.results.map((row) => ({ alertId: row.alert_id, pairId: row.pair_id, direction: row.direction, threshold: row.threshold_decimal, status: row.status, thresholdVersion: row.threshold_version, createdAt: row.created_at, updatedAt: row.updated_at })), triggered: [], planningAvailable: false }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
    return Response.json({ error: "alerts_unavailable" }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  try {
    await requireVerifiedSubject(request);
    return Response.json({ error: "price_alerts_retired" }, { status: 410, headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
    return Response.json({ error: "alerts_unavailable" }, { status: 503, headers: noStore });
  }
}

export async function PATCH(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const input = cancel.parse(await request.json());
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    const [updated] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`UPDATE price_alerts SET status = 'cancelled', threshold_version = threshold_version + 1, armed = 0, updated_at = ?
        WHERE alert_id = ? AND subject_reference = ? AND threshold_version = ? AND status IN ('active', 'paused')`)
        .bind(now, input.alertId, subject.subjectReference, input.version),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
        SELECT ?, ?, 'customer', ?, 'swap.alert.cancel', 'price_alert', ?, '{}', ? WHERE changes() = 1`)
        .bind(auditId, subject.subjectReference, subject.subjectReference, input.alertId, now),
      env.PROJECTION_DB.prepare(`UPDATE swap_reminder_occurrences SET reminder_state = 'superseded', updated_at = ?
        WHERE alert_id = ? AND subject_reference = ? AND reminder_state = 'due'
          AND EXISTS (SELECT 1 FROM audit_events WHERE audit_id = ?)`)
        .bind(now, input.alertId, subject.subjectReference, auditId)
    ]);
    if (!updated.meta.changes) return Response.json({ error: "alert_changed" }, { status: 409, headers: noStore });
    return Response.json({ updated: true, thresholdVersion: input.version + 1 }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_alert" }, { status: 400, headers: noStore });
    return Response.json({ error: "alerts_unavailable" }, { status: 503, headers: noStore });
  }
}
