import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { route, readJsonBody } from "@/lib/http/route";

const eventSchema = z.object({
  eventName: z.enum(["product_viewed", "activation_viewed", "funding_opened", "transaction_prepared", "transaction_submitted", "security_updated", "support_opened"]),
  surface: z.string().min(1).max(80),
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
});

export const POST = route("analytics.events.post", { unavailable: "capture_unavailable", invalid: "invalid_event" }, async (request: Request) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "analytics", subject: subject.subjectReference, limit: 120, windowSeconds: 60 });
  const input = eventSchema.parse(await readJsonBody(request));
  await env.PROJECTION_DB.prepare(`INSERT INTO product_events
    (event_id, subject_reference, session_reference, event_name, surface, properties_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), subject.subjectReference, subject.sessionReference, input.eventName, input.surface, JSON.stringify(input.properties), new Date().toISOString()).run();
  return new Response(null, { status: 204 });
});
