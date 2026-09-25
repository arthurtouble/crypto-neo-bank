import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { writeAuditEvent } from "@/lib/security/audit";
import { route } from "@/lib/http/route";

const schema = z.object({ purpose: z.enum(["marketing", "beta_operational"]), action: z.literal("withdrawn"), noticeVersion: z.string().max(40) }).strict();
export const POST = route("growth.consent.post", { unavailable: "consent_change_unavailable", invalid: "invalid_consent_change" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const input = schema.parse(await request.json());
  const now = new Date().toISOString();
  await env.PROJECTION_DB.prepare("INSERT INTO growth_consent_events (consent_event_id, subject_reference, purpose, action, notice_version, occurred_at) VALUES (?, ?, ?, 'withdrawn', ?, ?)")
    .bind(crypto.randomUUID(), subject.subjectReference, input.purpose, input.noticeVersion, now).run();
  try {
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: "growth_consent_withdrawn", targetType: "growth_consent", targetReference: input.purpose, evidence: { noticeVersion: input.noticeVersion }, occurredAt: now });
  } catch (error) {
    // The durable consent event is authoritative; an audit outage cannot undo withdrawal.
    console.error(JSON.stringify({ level: "error", event: "growth.consent.audit.failed", traceId, errorType: error instanceof Error ? error.name : "unknown" }));
  }
  return Response.json({ updated: true, traceId }, { headers: { "Cache-Control": "no-store" } });
});
