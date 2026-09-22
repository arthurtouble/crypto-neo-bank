import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { writeAuditEvent } from "@/lib/security/audit";

const schema = z.object({ purpose: z.enum(["marketing","beta_operational"]), action: z.literal("withdrawn"), noticeVersion: z.string().max(40) }).strict();
export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try { const subject = await requireVerifiedSubject(request); const input = schema.parse(await request.json()); const now = new Date().toISOString(); await env.PROJECTION_DB.prepare("INSERT INTO growth_consent_events (consent_event_id, application_id, subject_reference, purpose, action, notice_version, occurred_at) VALUES (?, NULL, ?, ?, 'withdrawn', ?, ?)").bind(crypto.randomUUID(), subject.subjectReference, input.purpose, input.noticeVersion, now).run(); await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: "growth_consent_withdrawn", targetType: "growth_consent", targetReference: input.purpose, evidence: { noticeVersion: input.noticeVersion }, occurredAt: now }); return Response.json({ updated: true, traceId }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 }); if (error instanceof z.ZodError) return Response.json({ error: "invalid_consent_change", traceId }, { status: 400 }); return Response.json({ error: "consent_change_unavailable", traceId }, { status: 503 }); }
}
