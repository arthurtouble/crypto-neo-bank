import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOperationsAdmin } from "@/lib/auth/admin";
import { writeAuditEvent } from "@/lib/security/audit";
import { route } from "@/lib/http/route";

const schema = z.object({ action: z.enum(["export", "delete", "reject"]), reason: z.string().max(200).optional() }).strict();

export const PATCH = route("ops.growth.data_requests.requestId.patch", { unavailable: "data_action_unavailable", invalid: "invalid_data_action" }, async (request: Request, { traceId }, context: { params: Promise<{ requestId: string }> }) => {
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
    const consent = await env.PROJECTION_DB.prepare("SELECT purpose, action, notice_version, occurred_at FROM growth_consent_events WHERE subject_reference = ? ORDER BY occurred_at")
      .bind(row.subject_reference).all();
    exportData = { consent: consent.results };
  }
  if (input.action === "delete") await env.PROJECTION_DB.prepare("DELETE FROM growth_consent_events WHERE subject_reference = ?").bind(row.subject_reference).run();

  const status = input.action === "reject" ? "rejected" : "completed";
  const now = new Date().toISOString();
  await env.PROJECTION_DB.prepare("UPDATE growth_data_requests SET status = ?, completed_at = ?, handled_by = ?, evidence_json = ? WHERE request_id = ?")
    .bind(status, now, admin.subjectReference, JSON.stringify({ action: input.action, reason: input.reason ?? null, financialAuthorityUntouched: true }), requestId).run();
  await writeAuditEvent(env.PROJECTION_DB, { subjectReference: row.subject_reference, actorType: "operator", actorReference: admin.subjectReference, action: `growth_data_request_${status}`, targetType: "growth_data_request", targetReference: requestId, evidence: { action: input.action, financialAuthorityUntouched: true }, occurredAt: now });
  return Response.json({ completed: status === "completed", export: exportData, traceId }, { headers: { "Cache-Control": "no-store", "Content-Disposition": input.action === "export" ? `attachment; filename="aurel-growth-export-${requestId}.json"` : "inline" } });
});
