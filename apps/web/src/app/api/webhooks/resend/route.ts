import { env } from "cloudflare:workers";
import { applyEmailEvent } from "@/lib/notifications/email-events";
import { verifySvix } from "@/lib/providers/webhooks";

const MAX_BODY_BYTES = 64 * 1024;
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Resend's delivery reports (lib/notifications/email-events.ts), signed with Svix and checked against the raw body
 * before anything is parsed. They only ever mark a notice's email as bounced; they never touch money or accounts.
 */
export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return reply(503, { error: "provider_not_connected", traceId });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return reply(413, { error: "payload_too_large", traceId });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return reply(413, { error: "payload_too_large", traceId });
  if (!await verifySvix({ headers: request.headers, rawBody, secret, nowMs: Date.now() })) {
    console.warn(JSON.stringify({ level: "warn", event: "webhook.signature_rejected", provider: "resend", traceId }));
    return reply(401, { error: "invalid_signature", traceId });
  }
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return reply(400, { error: "invalid_event", traceId }); }
  const outcome = await applyEmailEvent(env.PROJECTION_DB, payload);
  return reply(200, { received: true, outcome });
}
