import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

const eventSchema = z.object({
  eventName: z.enum(["product_viewed", "activation_viewed", "funding_opened", "transaction_prepared", "transaction_submitted", "security_updated", "support_opened"]),
  surface: z.string().min(1).max(80),
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
});

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "analytics", subject: subject.subjectReference, limit: 120, windowSeconds: 60 });
    const input = eventSchema.parse(await request.json());
    await env.PROJECTION_DB.prepare(`INSERT INTO product_events
      (event_id, subject_reference, session_reference, event_name, surface, properties_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), subject.subjectReference, subject.sessionReference, input.eventName, input.surface, JSON.stringify(input.properties), new Date().toISOString()).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", traceId }, { status: 429 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_event", traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "analytics.capture.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "capture_unavailable", traceId }, { status: 503 });
  }
}
