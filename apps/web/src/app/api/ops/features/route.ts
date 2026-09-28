import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOperator } from "@/lib/auth/access";
import { featureKeys } from "@/lib/features/flags";
import { route } from "@/lib/http/route";

const updateSchema = z.strictObject({ key: z.enum(featureKeys), enabled: z.boolean() });

const options = { invalid: "invalid_feature_flag", unavailable: "feature_flags_unavailable" };

export const GET = route("ops.features.get", options, async (request: Request, { traceId }) => {
  await requireOperator(request);
  const rows = await env.PROJECTION_DB.prepare("SELECT flag_key, enabled, updated_at, updated_by FROM feature_flags ORDER BY flag_key").all();
  return Response.json({ flags: rows.results, traceId });
});

export const PATCH = route("ops.features.patch", options, async (request: Request, { traceId }) => {
  const operator = await requireOperator(request);
  const input = updateSchema.parse(await request.json());
  const now = new Date().toISOString();
  await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare(`INSERT INTO feature_flags (flag_key, enabled, configuration_json, updated_at, updated_by) VALUES (?, ?, '{}', ?, ?)
      ON CONFLICT(flag_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(input.key, input.enabled ? 1 : 0, now, operator.email),
    env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      VALUES (?, NULL, 'operator', ?, 'feature_flag.updated', 'feature_flag', ?, ?, ?)`)
      .bind(crypto.randomUUID(), operator.email, input.key, JSON.stringify({ enabled: input.enabled }), now)
  ]);
  return Response.json({ updated: true, traceId });
});

