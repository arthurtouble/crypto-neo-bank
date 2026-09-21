import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";
import { featureKeys } from "@/lib/features/flags";

const updateSchema = z.object({ key: z.enum(featureKeys), enabled: z.boolean(), audience: z.enum(["all", "beta", "operations"]).default("all") });

function failure(error: unknown, traceId: string) {
  if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
  if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", traceId }, { status: 403 });
  if (error instanceof z.ZodError) return Response.json({ error: "invalid_feature_flag", issues: error.issues, traceId }, { status: 400 });
  return Response.json({ error: "feature_flags_unavailable", traceId }, { status: 503 });
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try { await requireOperationsAdmin(request); const rows = await env.PROJECTION_DB.prepare("SELECT flag_key, enabled, audience, updated_at, updated_by FROM feature_flags ORDER BY flag_key").all(); return Response.json({ flags: rows.results, traceId }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error, traceId); }
}

export async function PATCH(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const admin = await requireOperationsAdmin(request);
    const input = updateSchema.parse(await request.json());
    const now = new Date().toISOString();
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`INSERT INTO feature_flags (flag_key, enabled, audience, configuration_json, updated_at, updated_by) VALUES (?, ?, ?, '{}', ?, ?)
        ON CONFLICT(flag_key) DO UPDATE SET enabled = excluded.enabled, audience = excluded.audience, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .bind(input.key, input.enabled ? 1 : 0, input.audience, now, admin.subjectReference),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
        VALUES (?, ?, 'operator', ?, 'feature_flag.updated', 'feature_flag', ?, ?, ?)`)
        .bind(crypto.randomUUID(), admin.subjectReference, admin.subjectReference, input.key, JSON.stringify({ enabled: input.enabled, audience: input.audience }), now)
    ]);
    return Response.json({ updated: true, traceId });
  } catch (error) { return failure(error, traceId); }
}

