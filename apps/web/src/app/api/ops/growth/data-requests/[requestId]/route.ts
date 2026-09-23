import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";
import { writeAuditEvent } from "@/lib/security/audit";

const schema = z.object({ action: z.enum(["export", "delete", "reject"]), reason: z.string().max(200).optional() }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const traceId = crypto.randomUUID();
  try {
    const admin = await requireOperationsAdmin(request);
    const { requestId } = await context.params;
    z.string().uuid().parse(requestId);
    const input = schema.parse(await request.json());
    const row = await env.PROJECTION_DB.prepare("SELECT subject_reference, request_type, status FROM growth_data_requests WHERE request_id = ?")
      .bind(requestId).first<{ subject_reference: string; request_type: string; status: string }>();
    if (!row) return Response.json({ error: "not_found", traceId }, { status: 404 });
    if (row.status === "completed") return Response.json({ error: "already_completed", traceId }, { status: 409 });
    if (input.action !== "reject" && input.action !== row.request_type) return Response.json({ error: "action_mismatch", traceId }, { status: 409 });

    let exportData: unknown = null;
    if (input.action === "export") {
      const records = await env.PROJECTION_DB.batch([
        env.PROJECTION_DB.prepare("SELECT event_name, surface, properties_json, occurred_at FROM growth_events WHERE subject_reference = ? ORDER BY occurred_at").bind(row.subject_reference),
        env.PROJECTION_DB.prepare("SELECT purpose, template_key, template_version, status, sent_at, delivered_at, failed_at, created_at FROM growth_communications WHERE subject_reference = ? ORDER BY created_at").bind(row.subject_reference),
        env.PROJECTION_DB.prepare("SELECT purpose, action, notice_version, occurred_at FROM growth_consent_events WHERE subject_reference = ? ORDER BY occurred_at").bind(row.subject_reference),
        env.PROJECTION_DB.prepare("SELECT rule_version, activation_at, retained_at, result, evaluated_at FROM growth_retention_runs WHERE subject_reference = ?").bind(row.subject_reference)
      ]);
      exportData = { lifecycleEvents: records[0].results, communications: records[1].results, consent: records[2].results, retention: records[3].results };
    }
    if (input.action === "delete") await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("DELETE FROM growth_experiment_assignments WHERE assignment_key = ?").bind(row.subject_reference),
      env.PROJECTION_DB.prepare("DELETE FROM growth_communications WHERE subject_reference = ?").bind(row.subject_reference),
      env.PROJECTION_DB.prepare("DELETE FROM growth_consent_events WHERE subject_reference = ?").bind(row.subject_reference),
      env.PROJECTION_DB.prepare("DELETE FROM growth_events WHERE subject_reference = ?").bind(row.subject_reference),
      env.PROJECTION_DB.prepare("DELETE FROM growth_retention_runs WHERE subject_reference = ?").bind(row.subject_reference),
      env.PROJECTION_DB.prepare("DELETE FROM growth_referrals WHERE referrer_subject_reference = ? OR redeemed_subject_reference = ?").bind(row.subject_reference, row.subject_reference),
      env.PROJECTION_DB.prepare("DELETE FROM growth_invite_links WHERE referrer_subject_reference = ?").bind(row.subject_reference)
    ]);

    const status = input.action === "reject" ? "rejected" : "completed";
    const now = new Date().toISOString();
    await env.PROJECTION_DB.prepare("UPDATE growth_data_requests SET status = ?, completed_at = ?, handled_by = ?, evidence_json = ? WHERE request_id = ?")
      .bind(status, now, admin.subjectReference, JSON.stringify({ action: input.action, reason: input.reason ?? null, financialAuthorityUntouched: true }), requestId).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: row.subject_reference, actorType: "operator", actorReference: admin.subjectReference, action: `growth_data_request_${status}`, targetType: "growth_data_request", targetReference: requestId, evidence: { action: input.action, financialAuthorityUntouched: true }, occurredAt: now });
    return Response.json({ completed: status === "completed", export: exportData, traceId }, { headers: { "Cache-Control": "no-store", "Content-Disposition": input.action === "export" ? `attachment; filename="aurel-growth-export-${requestId}.json"` : "inline" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", traceId }, { status: 403 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_data_action", traceId }, { status: 400 });
    return Response.json({ error: "data_action_unavailable", traceId }, { status: 503 });
  }
}
