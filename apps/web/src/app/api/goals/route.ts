import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

type GoalRow = { goal_id: string; name: string; target_amount: string; target_asset: "USD" | "USDC"; target_date: string | null; source_kind: "provider" | "chain" | null; source_reference: string | null; status: "active" | "paused" | "archived"; created_at: string; updated_at: string };
const archiveSchema = z.strictObject({ goalId: z.string().uuid(), action: z.literal("archive") });
const headers = { "Cache-Control": "no-store" };

function present(row: GoalRow) {
  return { goalId: row.goal_id, name: row.name, targetAmount: row.target_amount, targetAsset: row.target_asset,
    targetDate: row.target_date ?? undefined, source: row.source_kind && row.source_reference ? { kind: row.source_kind, reference: row.source_reference } : undefined,
    currentAmount: null, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function GET(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const rows = await env.PROJECTION_DB.prepare(`SELECT goal_id, name, target_amount, target_asset, target_date, source_kind, source_reference, status, created_at, updated_at
      FROM savings_goals WHERE subject_reference = ? ORDER BY created_at DESC`).bind(subject.subjectReference).all<GoalRow>();
    return Response.json({ goals: rows.results.map(present), authority: "Historical planning targets; no balance is stored or implied" }, { headers });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    return Response.json({ error: "goals_unavailable" }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  try {
    await requireVerifiedSubject(request);
    return Response.json({ error: "goals_retired" }, { status: 410, headers });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    return Response.json({ error: "goals_unavailable" }, { status: 503, headers });
  }
}

export async function PATCH(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const input = archiveSchema.parse(await request.json());
    const now = new Date().toISOString();
    const [updated] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("UPDATE savings_goals SET status = 'archived', updated_at = ? WHERE goal_id = ? AND subject_reference = ? AND status != 'archived'")
        .bind(now, input.goalId, subject.subjectReference),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
        SELECT ?, ?, 'customer', ?, 'savings_goal.archive', 'savings_goal', ?, '{}', ? WHERE changes() = 1`)
        .bind(crypto.randomUUID(), subject.subjectReference, subject.subjectReference, input.goalId, now)
    ]);
    if (!updated.meta.changes) return Response.json({ error: "goal_not_found_or_archived" }, { status: 404, headers });
    return Response.json({ updated: true, status: "archived" }, { headers });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_goal_update" }, { status: 400, headers });
    return Response.json({ error: "goal_update_unavailable" }, { status: 503, headers });
  }
}
