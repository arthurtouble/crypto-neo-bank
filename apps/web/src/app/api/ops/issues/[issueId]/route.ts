import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";

const updateSchema = z.object({ status: z.enum(["acknowledged", "resolved"]) });

export async function PATCH(request: Request, context: { params: Promise<{ issueId: string }> }) {
  const traceId = crypto.randomUUID();
  try {
    const admin = await requireOperationsAdmin(request);
    const { issueId } = await context.params;
    z.string().uuid().parse(issueId);
    const input = updateSchema.parse(await request.json());
    const now = new Date().toISOString();
    const result = await env.PROJECTION_DB.prepare("UPDATE operational_issues SET status = ?, assigned_to = ?, resolved_at = ? WHERE issue_id = ?")
      .bind(input.status, admin.subjectReference, input.status === "resolved" ? now : null, issueId).run();
    if ((result.meta.changes ?? 0) === 0) return Response.json({ error: "issue_not_found", traceId }, { status: 404 });
    await env.PROJECTION_DB.prepare("INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at) VALUES (?, NULL, 'operator', ?, ?, 'operational_issue', ?, ?, ?)")
      .bind(crypto.randomUUID(), admin.subjectReference, `issue_${input.status}`, issueId, JSON.stringify({ status: input.status }), now).run();
    return Response.json({ updated: true, status: input.status, traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", message: error.message, traceId }, { status: 403 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_issue_update", issues: error.issues, traceId }, { status: 400 });
    return Response.json({ error: "issue_update_unavailable", traceId }, { status: 503 });
  }
}
