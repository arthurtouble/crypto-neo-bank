import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

type PlanRow = { plan_id: string; mode: "next_income" | "recurring"; spending_percent: number; goals_percent: number; earn_percent: number; status: "draft" | "paused" | "archived"; provider: string | null; provider_reference: string | null; created_at: string; updated_at: string };
const archiveSchema = z.strictObject({ planId: z.string().uuid(), action: z.literal("archive") });
const headers = { "Cache-Control": "no-store" };

function present(row: PlanRow) {
  return { planId: row.plan_id, mode: row.mode, spendingPercent: row.spending_percent, goalsPercent: row.goals_percent,
    earnPercent: row.earn_percent, status: row.status, provider: row.provider ?? undefined,
    providerReference: row.provider_reference ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function GET(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const rows = await env.PROJECTION_DB.prepare(`SELECT plan_id, mode, spending_percent, goals_percent, earn_percent, status, provider, provider_reference, created_at, updated_at
      FROM income_allocation_plans WHERE subject_reference = ? ORDER BY updated_at DESC`).bind(subject.subjectReference).all<PlanRow>();
    const active = rows.results.find((row) => row.status !== "archived");
    return Response.json({ plan: active ? present(active) : null,
      history: rows.results.map(present), authority: "Historical planning preferences; no income is detected or moved" }, { headers });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    return Response.json({ error: "income_plan_unavailable" }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  try {
    await requireVerifiedSubject(request);
    return Response.json({ error: "income_planning_retired" }, { status: 410, headers });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    return Response.json({ error: "income_plan_unavailable" }, { status: 503, headers });
  }
}

export async function PATCH(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const input = archiveSchema.parse(await request.json());
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    const [updated] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("UPDATE income_allocation_plans SET status = 'archived', updated_at = ? WHERE plan_id = ? AND subject_reference = ? AND status != 'archived'")
        .bind(now, input.planId, subject.subjectReference),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
        SELECT ?, ?, 'customer', ?, 'income_allocation.archive', 'income_allocation_plan', ?, '{}', ? WHERE changes() = 1`)
        .bind(auditId, subject.subjectReference, subject.subjectReference, input.planId, now)
    ]);
    if (!updated.meta.changes) return Response.json({ error: "income_plan_not_found_or_archived" }, { status: 404, headers });
    return Response.json({ updated: true, status: "archived" }, { headers });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_income_plan_update" }, { status: 400, headers });
    return Response.json({ error: "income_plan_update_unavailable" }, { status: 503, headers });
  }
}
