import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { writeAuditEvent } from "@/lib/security/audit";

const allocationSchema = z.object({
  mode: z.enum(["next_income", "recurring"]),
  spendingPercent: z.number().int().min(0).max(100),
  goalsPercent: z.number().int().min(0).max(100),
  earnPercent: z.number().int().min(0).max(100)
}).refine((value) => value.spendingPercent + value.goalsPercent + value.earnPercent === 100, { message: "Allocations must total 100%." });
const updateSchema = z.object({ planId: z.string().uuid(), action: z.enum(["pause", "resume", "archive"]) });
type PlanRow = { plan_id: string; mode: "next_income" | "recurring"; spending_percent: number; goals_percent: number; earn_percent: number; status: "draft" | "paused" | "archived"; provider: string | null; provider_reference: string | null; created_at: string; updated_at: string };

function present(row: PlanRow) {
  return { planId: row.plan_id, mode: row.mode, spendingPercent: row.spending_percent, goalsPercent: row.goals_percent, earnPercent: row.earn_percent, status: row.status, provider: row.provider ?? undefined, providerReference: row.provider_reference ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const row = await env.PROJECTION_DB.prepare(`SELECT plan_id, mode, spending_percent, goals_percent, earn_percent, status, provider, provider_reference, created_at, updated_at
      FROM income_allocation_plans WHERE subject_reference = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 1`).bind(subject.subjectReference).first<PlanRow>();
    return Response.json({ plan: row ? present(row) : null, authority: "Planning preference only; no income is detected or moved", activation: "Requires an active bank account and a separately approved provider mandate", traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    return Response.json({ error: "income_plan_unavailable", traceId }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "income_plan_save", subject: subject.subjectReference, limit: 30, windowSeconds: 3600 });
    const input = allocationSchema.parse(await request.json());
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
    const now = new Date().toISOString();
    const planId = crypto.randomUUID();
    const current = await env.PROJECTION_DB.prepare("SELECT plan_id FROM income_allocation_plans WHERE subject_reference = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 1").bind(subject.subjectReference).first<{ plan_id: string }>();
    const operations = [];
    if (current) operations.push(env.PROJECTION_DB.prepare("UPDATE income_allocation_plans SET status = 'archived', updated_at = ? WHERE plan_id = ? AND subject_reference = ?").bind(now, current.plan_id, subject.subjectReference));
    operations.push(env.PROJECTION_DB.prepare(`INSERT INTO income_allocation_plans
      (plan_id, subject_reference, mode, spending_percent, goals_percent, earn_percent, status, provider, provider_reference, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, NULL, ?, ?)`)
      .bind(planId, subject.subjectReference, input.mode, input.spendingPercent, input.goalsPercent, input.earnPercent, now, now));
    await env.PROJECTION_DB.batch(operations);
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: "income_allocation.draft_saved", targetType: "income_allocation_plan", targetReference: planId, evidence: { mode: input.mode, spendingPercent: input.spendingPercent, goalsPercent: input.goalsPercent, earnPercent: input.earnPercent, authority: "planning_only" } });
    return Response.json({ plan: { planId, ...input, status: "draft", createdAt: now, updatedAt: now }, traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_income_plan", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "income_plan.save_failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "income_plan_save_unavailable", traceId }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const input = updateSchema.parse(await request.json());
    const row = await env.PROJECTION_DB.prepare("SELECT status FROM income_allocation_plans WHERE plan_id = ? AND subject_reference = ?").bind(input.planId, subject.subjectReference).first<{ status: string }>();
    if (!row) return Response.json({ error: "income_plan_not_found", traceId }, { status: 404 });
    const next = input.action === "archive" ? "archived" : input.action === "pause" ? "paused" : "draft";
    if ((input.action === "pause" && row.status !== "draft") || (input.action === "resume" && row.status !== "paused") || row.status === "archived") return Response.json({ error: "invalid_income_plan_transition", traceId }, { status: 409 });
    await env.PROJECTION_DB.prepare("UPDATE income_allocation_plans SET status = ?, updated_at = ? WHERE plan_id = ? AND subject_reference = ?").bind(next, new Date().toISOString(), input.planId, subject.subjectReference).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: `income_allocation.${input.action}`, targetType: "income_allocation_plan", targetReference: input.planId });
    return Response.json({ updated: true, status: next, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_income_plan_update", issues: error.issues, traceId }, { status: 400 });
    return Response.json({ error: "income_plan_update_unavailable", traceId }, { status: 503 });
  }
}
