import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";
import { applicationDetail, applicationStatuses, canTransition, type ApplicationStatus } from "@/lib/growth/operations";
import { writeAuditEvent } from "@/lib/security/audit";

const updateSchema = z.object({ status: z.enum(applicationStatuses).optional(), fitBand: z.enum(["high","medium","low"]).nullable().optional(), assignedTo: z.string().max(120).nullable().optional(), decisionReason: z.enum(["cohort_fit","country_capacity","workflow_fit","timing","insufficient_context","duplicate","reopened_after_review"]).nullable().optional() }).strict();

function accessError(error: unknown, traceId: string) {
  if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
  if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", traceId }, { status: 403 });
  if (error instanceof z.ZodError) return Response.json({ error: "invalid_application_change", issues: error.issues, traceId }, { status: 400 });
  return Response.json({ error: "application_unavailable", traceId }, { status: 503 });
}

export async function GET(request: Request, context: { params: Promise<{ applicationId: string }> }) {
  const traceId = crypto.randomUUID();
  try {
    const admin = await requireOperationsAdmin(request); const { applicationId } = await context.params; z.string().uuid().parse(applicationId);
    const application = await applicationDetail(env.PROJECTION_DB, applicationId);
    if (!application) return Response.json({ error: "not_found", traceId }, { status: 404 });
    await writeAuditEvent(env.PROJECTION_DB, { actorType: "operator", actorReference: admin.subjectReference, action: "growth_application_viewed", targetType: "growth_application", targetReference: applicationId, evidence: { detailView: true } });
    return Response.json({ application, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return accessError(error, traceId); }
}

export async function PATCH(request: Request, context: { params: Promise<{ applicationId: string }> }) {
  const traceId = crypto.randomUUID();
  try {
    const admin = await requireOperationsAdmin(request); const { applicationId } = await context.params; z.string().uuid().parse(applicationId); const input = updateSchema.parse(await request.json());
    const current = await env.PROJECTION_DB.prepare("SELECT status FROM growth_applications WHERE application_id = ?").bind(applicationId).first<{ status: ApplicationStatus }>();
    if (!current) return Response.json({ error: "not_found", traceId }, { status: 404 });
    if (input.status && input.status !== current.status && !canTransition(current.status, input.status)) return Response.json({ error: "invalid_transition", traceId }, { status: 409 });
    if ((input.status === "declined" || (current.status === "declined" && input.status === "reviewing")) && !input.decisionReason) return Response.json({ error: "reason_required", traceId }, { status: 400 });
    const now = new Date().toISOString(); const nextStatus = input.status ?? current.status;
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`UPDATE growth_applications SET status = ?, fit_band = COALESCE(?, fit_band), assigned_to = COALESCE(?, assigned_to), decision_reason = COALESCE(?, decision_reason), reviewed_at = COALESCE(reviewed_at, ?), updated_at = ? WHERE application_id = ?`).bind(nextStatus, input.fitBand ?? null, input.assignedTo ?? null, input.decisionReason ?? null, now, now, applicationId),
      ...(nextStatus !== current.status && ["qualified","declined"].includes(nextStatus) ? [env.PROJECTION_DB.prepare(`INSERT INTO growth_events (event_id, application_id, subject_reference, anonymous_session_id, event_name, surface, campaign_id, content_id, properties_json, occurred_at) VALUES (?, ?, NULL, NULL, ?, 'operations', NULL, NULL, '{}', ?)`).bind(crypto.randomUUID(), applicationId, `application_${nextStatus}`, now)] : []),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at) VALUES (?, NULL, 'operator', ?, 'growth_application_updated', 'growth_application', ?, ?, ?)`).bind(crypto.randomUUID(), admin.subjectReference, applicationId, JSON.stringify({ previousStatus: current.status, status: nextStatus, fitBand: input.fitBand, assignedTo: input.assignedTo, decisionReason: input.decisionReason }), now)
    ]);
    return Response.json({ updated: true, status: nextStatus, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return accessError(error, traceId); }
}
