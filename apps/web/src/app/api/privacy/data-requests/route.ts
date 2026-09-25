import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { writeAuditEvent } from "@/lib/security/audit";

const schema = z.object({ requestType: z.enum(["export", "delete"]) }).strict();

export const GET = route("privacy.data_requests.get", { unavailable: "data_requests_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const rows = await env.PROJECTION_DB.prepare(`SELECT request_id, request_type, status, requested_at, completed_at
    FROM data_requests WHERE subject_reference = ? ORDER BY requested_at DESC LIMIT 20`).bind(subject.subjectReference).all();
  return Response.json({ requests: rows.results, traceId });
});

export const POST = route("privacy.data_requests.post", { unavailable: "data_request_unavailable", invalid: "invalid_request" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "data_request", subject: subject.subjectReference, limit: 5, windowSeconds: 86_400 });
  const input = schema.parse(await request.json());
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.PROJECTION_DB.prepare("INSERT INTO data_requests (request_id, subject_reference, request_type, status, requested_at, evidence_json) VALUES (?, ?, ?, 'received', ?, '{}')")
    .bind(id, subject.subjectReference, input.requestType, now).run();
  await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference,
    action: `data_${input.requestType}_requested`, targetType: "data_request", targetReference: id, occurredAt: now });
  return Response.json({ requestId: id, status: "received", traceId }, { status: 202 });
});
