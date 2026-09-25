import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { writeAuditEvent } from "@/lib/security/audit";
import { route } from "@/lib/http/route";

const schema = z.object({ requestType: z.enum(["export", "delete"]) }).strict();

export const POST = route("growth.data_requests.post", { unavailable: "data_request_unavailable", invalid: "invalid_request" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const input = schema.parse(await request.json());
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.PROJECTION_DB.prepare("INSERT INTO growth_data_requests (request_id, subject_reference, request_type, status, requested_at, evidence_json) VALUES (?, ?, ?, 'received', ?, '{}')")
    .bind(id, subject.subjectReference, input.requestType, now).run();
  await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: `growth_data_${input.requestType}_requested`, targetType: "growth_data_request", targetReference: id, occurredAt: now });
  return Response.json({ requestId: id, status: "received", traceId }, { status: 202, headers: { "Cache-Control": "no-store" } });
});
