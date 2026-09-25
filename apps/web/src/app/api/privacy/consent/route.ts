import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { hasConsent } from "@/lib/privacy/consent-state";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { writeAuditEvent } from "@/lib/security/audit";

const schema = z.object({ purpose: z.enum(["marketing", "service_updates"]), action: z.enum(["granted", "withdrawn"]), noticeVersion: z.string().min(1).max(40) }).strict();

export const GET = route("privacy.consent.get", { unavailable: "consent_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const [marketing, serviceUpdates] = await Promise.all([
    hasConsent(env.PROJECTION_DB, subject.subjectReference, "marketing"),
    hasConsent(env.PROJECTION_DB, subject.subjectReference, "service_updates")
  ]);
  return Response.json({ consent: { marketing, serviceUpdates }, traceId });
});

export const POST = route("privacy.consent.post", { unavailable: "consent_change_unavailable", invalid: "invalid_consent_change" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "consent_change", subject: subject.subjectReference, limit: 20, windowSeconds: 600 });
  const input = schema.parse(await request.json());
  const now = new Date().toISOString();
  await env.PROJECTION_DB.prepare("INSERT INTO consent_events (consent_event_id, subject_reference, purpose, action, notice_version, occurred_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), subject.subjectReference, input.purpose, input.action, input.noticeVersion, now).run();
  try {
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference,
      action: `consent_${input.action}`, targetType: "consent", targetReference: input.purpose, evidence: { noticeVersion: input.noticeVersion }, occurredAt: now });
  } catch (error) {
    // The durable consent event is authoritative; an audit outage cannot undo the customer's choice.
    console.error(JSON.stringify({ level: "error", event: "privacy.consent.audit.failed", traceId, errorType: error instanceof Error ? error.name : "unknown" }));
  }
  return Response.json({ updated: true, purpose: input.purpose, granted: input.action === "granted", traceId });
});
