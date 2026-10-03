import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOperator } from "@/lib/auth/access";
import { route, readJsonBody } from "@/lib/http/route";

/** Resolving says what was done, so the next operator can see why it closed. */
const updateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("acknowledged"), note: z.string().trim().max(500).optional() }),
  z.object({ status: z.literal("resolved"), note: z.string().trim().min(4).max(500) })
]);

export const PATCH = route("ops.issues.issueId.patch", { unavailable: "issue_update_unavailable", invalid: "invalid_issue_update" }, async (request: Request, { traceId }, context: { params: Promise<{ issueId: string }> }) => {
  const operator = await requireOperator(request);
  const { issueId } = await context.params;
  z.string().uuid().parse(issueId);
  const input = updateSchema.parse(await readJsonBody(request));
  const now = new Date().toISOString();
  const result = await env.PROJECTION_DB.prepare("UPDATE operational_issues SET status = ?, assigned_to = ?, resolved_at = ? WHERE issue_id = ?")
    .bind(input.status, operator.email, input.status === "resolved" ? now : null, issueId).run();
  if ((result.meta.changes ?? 0) === 0) return Response.json({ error: "issue_not_found", traceId }, { status: 404 });
  await env.PROJECTION_DB.prepare("INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at) VALUES (?, NULL, 'operator', ?, ?, 'operational_issue', ?, ?, ?)")
    .bind(crypto.randomUUID(), operator.email, `issue_${input.status}`, issueId, JSON.stringify({ status: input.status, ...(input.note ? { note: input.note } : {}) }), now).run();
  return Response.json({ updated: true, status: input.status, traceId });
});
