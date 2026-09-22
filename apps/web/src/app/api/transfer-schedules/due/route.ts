import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, requireFeature } from "@/lib/features/flags";
import { nextOccurrence, type ScheduleType } from "@/lib/schedules/recurrence";

type DueSchedule = { schedule_id: string; subject_reference: string; schedule_type: ScheduleType; destination_kind: string; destination_reference: string; destination_label: string; asset: string; amount: string; next_run_at: string; status: string; provider: string | null; time_zone: string | null; anchor_local: string | null };
type DueRow = { occurrence_id: string; schedule_id: string; due_at: string; reminder_state: string; destination_label: string; destination_reference: string; asset: string; amount: string; time_zone: string };
type ReviewRow = DueRow & { status: string; destination_kind: string; provider: string | null };
const reviewSchema = z.object({ occurrenceId: z.string().min(1).max(80) });
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    const now = new Date();
    const schedules = await env.PROJECTION_DB.prepare(`SELECT schedule_id, subject_reference, schedule_type, destination_kind, destination_reference, destination_label, asset, amount, next_run_at, status, provider, time_zone, anchor_local
      FROM transfer_schedules WHERE subject_reference = ? AND status = 'approval_required' AND provider IS NULL AND destination_kind = 'wallet' AND time_zone IS NOT NULL AND anchor_local IS NOT NULL AND next_run_at <= ? LIMIT 50`)
      .bind(subject.subjectReference, now.toISOString()).all<DueSchedule>();
    for (const schedule of schedules.results) {
      let cursor = schedule.next_run_at;
      // Catch up in bounded batches. Further overdue periods appear on the
      // next authenticated read, without a server timer or wallet authority.
      for (let index = 0; index < 12 && cursor <= now.toISOString(); index++) {
        const next = nextOccurrence({ scheduleType: schedule.schedule_type, timeZone: schedule.time_zone!, anchorLocal: schedule.anchor_local!, after: new Date(cursor) });
        // Each write is conditional on the schedule remaining active. Unique
        // key makes repeated or concurrent reads safe.
        await env.PROJECTION_DB.prepare(`INSERT OR IGNORE INTO schedule_occurrences (occurrence_id, schedule_id, subject_reference, due_at, reminder_state, created_at)
        SELECT ?, schedule_id, subject_reference, ?, 'due', ? FROM transfer_schedules
        WHERE schedule_id = ? AND subject_reference = ? AND status = 'approval_required' AND next_run_at = ?`)
          .bind(crypto.randomUUID(), cursor, now.toISOString(), schedule.schedule_id, subject.subjectReference, cursor).run();
        if (!next) break;
        const advanced = await env.PROJECTION_DB.prepare(`UPDATE transfer_schedules SET next_run_at = ?, updated_at = ? WHERE schedule_id = ? AND subject_reference = ? AND status = 'approval_required' AND next_run_at = ?`)
          .bind(next.toISOString(), now.toISOString(), schedule.schedule_id, subject.subjectReference, cursor).run();
        if (!advanced.meta.changes) break;
        cursor = next.toISOString();
      }
    }
    const rows = await env.PROJECTION_DB.prepare(`SELECT o.occurrence_id, o.schedule_id, o.due_at, o.reminder_state, s.destination_label, s.destination_reference, s.asset, s.amount, s.time_zone
      FROM schedule_occurrences o JOIN transfer_schedules s ON s.schedule_id = o.schedule_id
      WHERE o.subject_reference = ? AND s.subject_reference = ? AND s.status = 'approval_required' AND o.reminder_state != 'dismissed'
      ORDER BY o.due_at DESC LIMIT 50`).bind(subject.subjectReference, subject.subjectReference).all<DueRow>();
    return Response.json({ occurrences: rows.results.map((row) => ({ occurrenceId: row.occurrence_id, scheduleId: row.schedule_id, dueAt: row.due_at, reminderState: row.reminder_state, destinationLabel: row.destination_label, amount: row.amount, asset: row.asset, timeZone: row.time_zone })), observedAt: now.toISOString(), traceId }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401, headers: noStore });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code, traceId }, { status: 403, headers: noStore });
    console.error(JSON.stringify({ level: "error", event: "schedule.due.read.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "due_unavailable", traceId }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await requireFeature(env.PROJECTION_DB, "direct_transfers");
    const { occurrenceId } = reviewSchema.parse(await request.json());
    const row = await env.PROJECTION_DB.prepare(`SELECT o.occurrence_id, o.schedule_id, o.due_at, o.reminder_state, s.status, s.destination_kind, s.provider, s.destination_label, s.destination_reference, s.asset, s.amount, s.time_zone
      FROM schedule_occurrences o JOIN transfer_schedules s ON s.schedule_id = o.schedule_id
      WHERE o.occurrence_id = ? AND o.subject_reference = ? AND s.subject_reference = ?`).bind(occurrenceId, subject.subjectReference, subject.subjectReference).first<ReviewRow>();
    if (!row) return Response.json({ error: "occurrence_not_found", traceId }, { status: 404, headers: noStore });
    if (row.status !== "approval_required" || row.destination_kind !== "wallet" || row.provider || row.reminder_state === "dismissed") return Response.json({ error: "schedule_inactive", traceId }, { status: 409, headers: noStore });
    const lock = await env.PROJECTION_DB.prepare("SELECT account_locked FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference).first<{ account_locked: number }>();
    if (!lock || lock.account_locked) return Response.json({ error: "account_locked", traceId }, { status: 423, headers: noStore });
    const recipient = await env.PROJECTION_DB.prepare("SELECT available_at FROM address_book_entries WHERE subject_reference = ? AND chain_family = 'evm' AND address = ?")
      .bind(subject.subjectReference, row.destination_reference).first<{ available_at: string }>();
    if (!recipient || recipient.available_at > new Date().toISOString()) return Response.json({ error: "recipient_unavailable", traceId }, { status: 409, headers: noStore });
    const marked = await env.PROJECTION_DB.prepare(`UPDATE schedule_occurrences SET reminder_state = 'review_opened', reviewed_at = ?
      WHERE occurrence_id = ? AND subject_reference = ? AND reminder_state != 'dismissed'
      AND EXISTS (SELECT 1 FROM transfer_schedules s WHERE s.schedule_id = schedule_occurrences.schedule_id AND s.subject_reference = ? AND s.status = 'approval_required')
      AND EXISTS (SELECT 1 FROM security_profiles p WHERE p.subject_reference = ? AND p.account_locked = 0)
      AND EXISTS (SELECT 1 FROM address_book_entries a WHERE a.subject_reference = ? AND a.chain_family = 'evm' AND a.address = ? AND a.available_at <= ?)`)
      .bind(new Date().toISOString(), occurrenceId, subject.subjectReference, subject.subjectReference, subject.subjectReference, subject.subjectReference, row.destination_reference, new Date().toISOString()).run();
    if (!marked.meta.changes) return Response.json({ error: "schedule_changed", traceId }, { status: 409, headers: noStore });
    const reviewUrl = `/app/assets?sendTo=${encodeURIComponent(row.destination_reference)}&asset=${encodeURIComponent(row.asset)}`;
    return Response.json({ reviewUrl, message: "Enter the amount and complete direct-send review before any money moves.", traceId }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401, headers: noStore });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code, traceId }, { status: 403, headers: noStore });
    if (error instanceof FeatureUnavailableError) return Response.json({ error: "feature_unavailable", traceId }, { status: 503, headers: noStore });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_occurrence", traceId }, { status: 400, headers: noStore });
    console.error(JSON.stringify({ level: "error", event: "schedule.due.review.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "review_unavailable", traceId }, { status: 503, headers: noStore });
  }
}
