import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOperationsAdmin } from "@/lib/auth/admin";
import { errorResponse, route } from "@/lib/http/route";
import { eraseSubjectData, exportSubjectData } from "@/lib/privacy/subject-data";
import { writeAuditEvent } from "@/lib/security/audit";

const schema = z.object({ action: z.enum(["export", "delete", "reject"]), reason: z.string().max(200).optional() }).strict();

/** Fulfil a customer data request from the table inventory in lib/privacy/subject-data. */
export const PATCH = route("ops.privacy.data_requests.fulfil", { unavailable: "data_action_unavailable", invalid: "invalid_data_action" },
  async (request: Request, context, params: { params: Promise<{ requestId: string }> }) => {
    const admin = await requireOperationsAdmin(request);
    const requestId = z.string().uuid().parse((await params.params).requestId);
    const input = schema.parse(await request.json());
    const row = await env.PROJECTION_DB.prepare("SELECT subject_reference, request_type, status FROM data_requests WHERE request_id = ?")
      .bind(requestId).first<{ subject_reference: string; request_type: string; status: string }>();
    if (!row) return errorResponse(404, "not_found", context);
    if (row.status === "completed" || row.status === "rejected") return errorResponse(409, "already_closed", context);
    if (input.action !== "reject" && input.action !== row.request_type) return errorResponse(409, "action_mismatch", context);

    const exportData = input.action === "export" ? await exportSubjectData(env.PROJECTION_DB, row.subject_reference) : null;
    const erasure = input.action === "delete" ? await eraseSubjectData(env.PROJECTION_DB, row.subject_reference) : null;

    const status = input.action === "reject" ? "rejected" : "completed";
    const now = new Date().toISOString();
    const evidence = { action: input.action, reason: input.reason ?? null, erased: erasure?.erased ?? null, financialAuthorityUntouched: true };
    await env.PROJECTION_DB.prepare("UPDATE data_requests SET status = ?, completed_at = ?, handled_by = ?, evidence_json = ? WHERE request_id = ?")
      .bind(status, now, admin.subjectReference, JSON.stringify(evidence), requestId).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: row.subject_reference, actorType: "operator", actorReference: admin.subjectReference,
      action: `data_request_${status}`, targetType: "data_request", targetReference: requestId, evidence, occurredAt: now });
    return Response.json({ completed: status === "completed", export: exportData, erasure, traceId: context.traceId }, {
      headers: input.action === "export" ? { "Content-Disposition": `attachment; filename="aura-data-export-${requestId}.json"` } : {} });
  });
