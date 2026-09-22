import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { writeAuditEvent } from "@/lib/security/audit";

const createSchema = z.object({
  scheduleType: z.enum(["one_time", "weekly", "monthly"]),
  destinationKind: z.enum(["wallet", "bank"]),
  destinationReference: z.string().trim().min(1).max(200),
  destinationLabel: z.string().trim().min(1).max(80),
  rail: z.enum(["ach", "wire", "fednow"]).optional(),
  asset: z.enum(["USDC", "ETH", "WETH", "USD"]),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/).refine((value) => Number(value) > 0, "Amount must be greater than zero."),
  nextRunAt: z.string().datetime()
});
const updateSchema = z.object({ scheduleId: z.string().uuid(), action: z.enum(["pause", "resume", "cancel"]) });
type ScheduleRow = { schedule_id: string; schedule_type: string; destination_kind: string; destination_reference: string; destination_label: string; rail: string | null; asset: string; amount: string; next_run_at: string; status: string; provider: string | null; created_at: string; updated_at: string };

function present(row: ScheduleRow) {
  return { scheduleId: row.schedule_id, scheduleType: row.schedule_type, destinationKind: row.destination_kind, destinationReference: row.destination_reference, destinationLabel: row.destination_label, rail: row.rail, asset: row.asset, amount: row.amount, nextRunAt: row.next_run_at, status: row.status, provider: row.provider, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const rows = await env.PROJECTION_DB.prepare(`SELECT schedule_id, schedule_type, destination_kind, destination_reference, destination_label, rail, asset, amount, next_run_at, status, provider, created_at, updated_at
      FROM transfer_schedules WHERE subject_reference = ? AND status != 'cancelled' ORDER BY next_run_at`).bind(subject.subjectReference).all<ScheduleRow>();
    return Response.json({ schedules: rows.results.map(present), authority: "Approval-required workflow plans; providers and chains remain authoritative", observedAt: new Date().toISOString(), traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    console.error(JSON.stringify({ level: "error", event: "schedules.read.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "schedules_unavailable", traceId }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "schedule_create", subject: subject.subjectReference, limit: 12, windowSeconds: 3600 });
    const input = createSchema.parse(await request.json());
    const nextRunAt = new Date(input.nextRunAt);
    if (nextRunAt.getTime() < Date.now() + 300_000 || nextRunAt.getTime() > Date.now() + 366 * 86_400_000) return Response.json({ error: "invalid_schedule_date", message: "Choose a time between five minutes and one year from now.", traceId }, { status: 400 });
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
    if (input.destinationKind === "bank") return Response.json({ error: "setup_required", message: "Connect a banking provider before scheduling a bank transfer.", nextAction: { label: "Set Up Bank Transfers" }, traceId }, { status: 409 });
    const address = input.destinationReference.toLowerCase();
    const saved = await env.PROJECTION_DB.prepare("SELECT entry_id, available_at FROM address_book_entries WHERE subject_reference = ? AND chain_family = 'evm' AND address = ?").bind(subject.subjectReference, address).first<{ entry_id: string; available_at: string }>();
    if (!saved) return Response.json({ error: "recipient_not_saved", message: "Save this recipient before creating a schedule.", traceId }, { status: 409 });
    if (new Date(saved.available_at) > new Date()) return Response.json({ error: "recipient_cooling", message: "This recipient is still in its security cooling period.", availableAt: saved.available_at, traceId }, { status: 409 });
    const now = new Date().toISOString();
    const scheduleId = crypto.randomUUID();
    await env.PROJECTION_DB.prepare(`INSERT INTO transfer_schedules
      (schedule_id, subject_reference, schedule_type, destination_kind, destination_reference, destination_label, rail, asset, amount, next_run_at, status, provider, provider_schedule_reference, created_at, updated_at)
      VALUES (?, ?, ?, 'wallet', ?, ?, NULL, ?, ?, ?, 'approval_required', NULL, NULL, ?, ?)`)
      .bind(scheduleId, subject.subjectReference, input.scheduleType, address, input.destinationLabel, input.asset, input.amount, nextRunAt.toISOString(), now, now).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: "transfer.schedule.created", targetType: "transfer_schedule", targetReference: scheduleId, evidence: { scheduleType: input.scheduleType, nextRunAt: nextRunAt.toISOString(), execution: "approval_required" } });
    return Response.json({ schedule: { scheduleId, ...input, nextRunAt: nextRunAt.toISOString(), status: "approval_required" }, traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_schedule", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "schedules.create.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "schedule_create_unavailable", traceId }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const input = updateSchema.parse(await request.json());
    const row = await env.PROJECTION_DB.prepare("SELECT status, provider FROM transfer_schedules WHERE schedule_id = ? AND subject_reference = ?").bind(input.scheduleId, subject.subjectReference).first<{ status: string; provider: string | null }>();
    if (!row) return Response.json({ error: "schedule_not_found", traceId }, { status: 404 });
    if (row.provider) return Response.json({ error: "provider_action_required", message: "This schedule must be changed through its provider.", traceId }, { status: 409 });
    const allowed = input.action === "pause" ? row.status === "approval_required" : input.action === "resume" ? row.status === "paused" : row.status !== "cancelled";
    if (!allowed) return Response.json({ error: "invalid_schedule_transition", message: `A ${row.status} schedule cannot ${input.action}.`, traceId }, { status: 409 });
    const status = input.action === "cancel" ? "cancelled" : input.action === "pause" ? "paused" : "approval_required";
    const now = new Date().toISOString();
    await env.PROJECTION_DB.prepare("UPDATE transfer_schedules SET status = ?, updated_at = ? WHERE schedule_id = ? AND subject_reference = ?").bind(status, now, input.scheduleId, subject.subjectReference).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: `transfer.schedule.${input.action}`, targetType: "transfer_schedule", targetReference: input.scheduleId });
    return Response.json({ updated: true, status, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_schedule_update", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "schedules.update.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "schedule_update_unavailable", traceId }, { status: 503 });
  }
}
