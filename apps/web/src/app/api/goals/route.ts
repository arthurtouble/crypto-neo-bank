import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { writeAuditEvent } from "@/lib/security/audit";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  targetAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  targetAsset: z.enum(["USD", "USDC"]),
  targetDate: z.string().date().optional()
});
const updateSchema = z.object({ goalId: z.string().uuid(), action: z.enum(["pause", "resume", "archive"]) });
type GoalRow = { goal_id: string; name: string; target_amount: string; target_asset: "USD" | "USDC"; target_date: string | null; source_kind: "provider" | "chain" | null; source_reference: string | null; status: "active" | "paused" | "archived"; created_at: string; updated_at: string };

function present(row: GoalRow) {
  return { goalId: row.goal_id, name: row.name, targetAmount: row.target_amount, targetAsset: row.target_asset, targetDate: row.target_date ?? undefined, source: row.source_kind && row.source_reference ? { kind: row.source_kind, reference: row.source_reference } : undefined, currentAmount: null, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const rows = await env.PROJECTION_DB.prepare(`SELECT goal_id, name, target_amount, target_asset, target_date, source_kind, source_reference, status, created_at, updated_at
      FROM savings_goals WHERE subject_reference = ? AND status != 'archived' ORDER BY created_at DESC`).bind(subject.subjectReference).all<GoalRow>();
    return Response.json({ goals: rows.results.map(present), authority: "Planning targets only; no balance is stored or implied", traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    return Response.json({ error: "goals_unavailable", traceId }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "goal_create", subject: subject.subjectReference, limit: 20, windowSeconds: 3600 });
    const input = createSchema.parse(await request.json());
    if (input.targetDate && new Date(`${input.targetDate}T23:59:59Z`).getTime() < Date.now()) return Response.json({ error: "invalid_target_date", message: "Choose a future date.", traceId }, { status: 400 });
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
    const goalId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.PROJECTION_DB.prepare(`INSERT INTO savings_goals (goal_id, subject_reference, name, target_amount, target_asset, target_date, source_kind, source_reference, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'active', ?, ?)`).bind(goalId, subject.subjectReference, input.name, input.targetAmount, input.targetAsset, input.targetDate ?? null, now, now).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: "savings_goal.created", targetType: "savings_goal", targetReference: goalId, evidence: { targetAsset: input.targetAsset, targetDate: input.targetDate ?? null } });
    return Response.json({ goal: { goalId, ...input, currentAmount: null, status: "active", createdAt: now, updatedAt: now }, traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_goal", issues: error.issues, traceId }, { status: 400 });
    return Response.json({ error: "goal_create_unavailable", traceId }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const input = updateSchema.parse(await request.json());
    const row = await env.PROJECTION_DB.prepare("SELECT status FROM savings_goals WHERE goal_id = ? AND subject_reference = ?").bind(input.goalId, subject.subjectReference).first<{ status: string }>();
    if (!row) return Response.json({ error: "goal_not_found", traceId }, { status: 404 });
    const status = input.action === "archive" ? "archived" : input.action === "pause" ? "paused" : "active";
    if ((input.action === "pause" && row.status !== "active") || (input.action === "resume" && row.status !== "paused")) return Response.json({ error: "invalid_goal_transition", traceId }, { status: 409 });
    await env.PROJECTION_DB.prepare("UPDATE savings_goals SET status = ?, updated_at = ? WHERE goal_id = ? AND subject_reference = ?").bind(status, new Date().toISOString(), input.goalId, subject.subjectReference).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: `savings_goal.${input.action}`, targetType: "savings_goal", targetReference: input.goalId });
    return Response.json({ updated: true, status, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_goal_update", issues: error.issues, traceId }, { status: 400 });
    return Response.json({ error: "goal_update_unavailable", traceId }, { status: 503 });
  }
}

