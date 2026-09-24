import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, requireFeature } from "@/lib/features/flags";
import { nextOccurrence } from "@/lib/schedules/recurrence";

const createSchema = z.object({
  scheduleType: z.enum(["one_time", "weekly", "monthly"]),
  destinationKind: z.enum(["wallet", "bank"]),
  destinationReference: z.string().trim().min(1).max(200),
  destinationLabel: z.string().trim().min(1).max(80),
  rail: z.enum(["ach", "wire", "fednow"]).optional(),
  asset: z.enum(["USDC", "ETH", "WETH", "USD"]),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/).refine((value) => Number(value) > 0, "Amount must be greater than zero."),
  timeZone: z.string().min(1).max(100),
  anchorLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
}).superRefine((input, context) => {
  if (input.destinationKind === "wallet" && !/^0x[a-fA-F0-9]{40}$/.test(input.destinationReference)) context.addIssue({ code: "custom", path: ["destinationReference"], message: "Enter a valid EVM wallet address." });
});
const updateSchema = z.object({ scheduleId: z.string().uuid(), action: z.enum(["pause", "resume", "cancel"]) });
type ScheduleRow = { schedule_id: string; schedule_type: string; destination_kind: string; destination_reference: string; destination_label: string; rail: string | null; asset: string; amount: string; next_run_at: string; status: string; provider: string | null; time_zone: string | null; anchor_local: string | null; created_at: string; updated_at: string };

function present(row: ScheduleRow) {
  return { scheduleId: row.schedule_id, scheduleType: row.schedule_type, destinationKind: row.destination_kind, destinationReference: row.destination_reference, destinationLabel: row.destination_label, rail: row.rail, asset: row.asset, amount: row.amount, nextRunAt: row.next_run_at, status: row.status, provider: row.provider, timeZone: row.time_zone, anchorLocal: row.anchor_local, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const rows = await env.PROJECTION_DB.prepare(`SELECT schedule_id, schedule_type, destination_kind, destination_reference, destination_label, rail, asset, amount, next_run_at, status, provider, time_zone, anchor_local, created_at, updated_at
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
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await requireFeature(env.PROJECTION_DB, "direct_transfers");
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "schedule_create", subject: subject.subjectReference, limit: 12, windowSeconds: 3600 });
    const input = createSchema.parse(await request.json());
    let nextRunAt: Date;
    try { nextRunAt = nextOccurrence({ scheduleType: "one_time", timeZone: input.timeZone, anchorLocal: input.anchorLocal, after: new Date(0) })!; }
    catch { return Response.json({ error: "invalid_schedule_time", message: "Choose a valid local time and timezone.", traceId }, { status: 400 }); }
    if (nextRunAt.getTime() < Date.now() + 300_000 || nextRunAt.getTime() > Date.now() + 366 * 86_400_000) return Response.json({ error: "invalid_schedule_date", message: "Choose a time between five minutes and one year from now.", traceId }, { status: 400 });
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
    const profile = await env.PROJECTION_DB.prepare("SELECT account_locked FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference).first<{ account_locked: number }>();
    if (!profile || profile.account_locked) return Response.json({ error: "account_locked", message: "Unlock your account before creating a schedule.", traceId }, { status: 423 });
    if (input.destinationKind === "bank") return Response.json({ error: "setup_required", message: "Connect a banking provider before scheduling a bank transfer.", nextAction: { label: "Set Up Bank Transfers" }, traceId }, { status: 409 });
    const address = input.destinationReference.toLowerCase();
    const saved = await env.PROJECTION_DB.prepare("SELECT entry_id, available_at FROM address_book_entries WHERE subject_reference = ? AND chain_family = 'evm' AND address = ?").bind(subject.subjectReference, address).first<{ entry_id: string; available_at: string }>();
    if (!saved) return Response.json({ error: "recipient_not_saved", message: "Save this recipient before creating a schedule.", traceId }, { status: 409 });
    if (new Date(saved.available_at) > new Date()) return Response.json({ error: "recipient_cooling", message: "This recipient is still in its security cooling period.", availableAt: saved.available_at, traceId }, { status: 409 });
    const now = new Date().toISOString();
    const scheduleId = crypto.randomUUID();
    await env.PROJECTION_DB.batch([env.PROJECTION_DB.prepare(`INSERT INTO transfer_schedules
      (schedule_id, subject_reference, schedule_type, destination_kind, destination_reference, destination_label, rail, asset, amount, next_run_at, status, provider, provider_schedule_reference, time_zone, anchor_local, created_at, updated_at)
      VALUES (?, ?, ?, 'wallet', ?, ?, NULL, ?, ?, ?, 'approval_required', NULL, NULL, ?, ?, ?, ?)`)
      .bind(scheduleId, subject.subjectReference, input.scheduleType, address, input.destinationLabel, input.asset, input.amount, nextRunAt.toISOString(), input.timeZone, input.anchorLocal, now, now),
    env.PROJECTION_DB.prepare(`INSERT INTO audit_events
      (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      VALUES (?, ?, 'customer', ?, 'transfer.schedule.created', 'transfer_schedule', ?, ?, ?)`)
      .bind(crypto.randomUUID(), subject.subjectReference, subject.subjectReference, scheduleId,
        JSON.stringify({ scheduleType: input.scheduleType, nextRunAt: nextRunAt.toISOString(), execution: "approval_required" }), now)]);
    return Response.json({ schedule: { scheduleId, ...input, nextRunAt: nextRunAt.toISOString(), status: "approval_required" }, traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code, message: error.message, traceId }, { status: 403 });
    if (error instanceof FeatureUnavailableError) return Response.json({ error: "feature_unavailable", message: error.message, traceId }, { status: 503 });
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
    const row = await env.PROJECTION_DB.prepare("SELECT status, provider, schedule_type, time_zone, anchor_local FROM transfer_schedules WHERE schedule_id = ? AND subject_reference = ?").bind(input.scheduleId, subject.subjectReference).first<{ status: string; provider: string | null; schedule_type: "one_time" | "weekly" | "monthly"; time_zone: string | null; anchor_local: string | null }>();
    if (!row) return Response.json({ error: "schedule_not_found", traceId }, { status: 404 });
    if (row.provider) return Response.json({ error: "provider_action_required", message: "This schedule must be changed through its provider.", traceId }, { status: 409 });
    const allowed = input.action === "pause" ? row.status === "approval_required" : input.action === "resume" ? row.status === "paused" : row.status === "approval_required" || row.status === "paused";
    if (!allowed) return Response.json({ error: "invalid_schedule_transition", message: `A ${row.status} schedule cannot ${input.action}.`, traceId }, { status: 409 });
    const status = input.action === "cancel" ? "cancelled" : input.action === "pause" ? "paused" : "approval_required";
    const now = new Date().toISOString();
    let nextRunAt: string | null = null;
    if (input.action === "resume") {
      await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
      await requireFeature(env.PROJECTION_DB, "direct_transfers");
      const lock = await env.PROJECTION_DB.prepare("SELECT account_locked FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference).first<{ account_locked: number }>();
      if (!lock || lock.account_locked) return Response.json({ error: "account_locked", traceId }, { status: 423 });
      if (!row.time_zone || !row.anchor_local) return Response.json({ error: "legacy_schedule", message: "Recreate this schedule to choose a timezone before resuming it.", traceId }, { status: 409 });
      nextRunAt = nextOccurrence({ scheduleType: row.schedule_type, timeZone: row.time_zone, anchorLocal: row.anchor_local, after: new Date(now) })?.toISOString() ?? null;
      if (!nextRunAt) return Response.json({ error: "schedule_elapsed", message: "This one-time review time has passed. Create a new schedule.", traceId }, { status: 409 });
    }
    const auditId = crypto.randomUUID();
    const [updated] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("UPDATE transfer_schedules SET status = ?, next_run_at = COALESCE(?, next_run_at), updated_at = ? WHERE schedule_id = ? AND subject_reference = ? AND status = ? AND provider IS NULL")
        .bind(status, nextRunAt, now, input.scheduleId, subject.subjectReference, row.status),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events
        (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
        SELECT ?, ?, 'customer', ?, ?, 'transfer_schedule', ?, '{}', ? WHERE changes() = 1`)
        .bind(auditId, subject.subjectReference, subject.subjectReference, `transfer.schedule.${input.action}`, input.scheduleId, now),
      env.PROJECTION_DB.prepare(`UPDATE schedule_occurrences SET reminder_state = 'dismissed'
        WHERE schedule_id = ? AND subject_reference = ? AND reminder_state != 'dismissed'
        AND EXISTS (SELECT 1 FROM audit_events WHERE audit_id = ?)`)
        .bind(input.scheduleId, subject.subjectReference, auditId)
    ]);
    if (!updated.meta.changes) return Response.json({ error: "schedule_changed", message: "This schedule changed. Refresh before trying again.", traceId }, { status: 409 });
    return Response.json({ updated: true, status, nextRunAt, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code, message: error.message, traceId }, { status: 403 });
    if (error instanceof FeatureUnavailableError) return Response.json({ error: "feature_unavailable", message: error.message, traceId }, { status: 503 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_schedule_update", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "schedules.update.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "schedule_update_unavailable", traceId }, { status: 503 });
  }
}
