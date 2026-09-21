import { env } from "cloudflare:workers";
import { providerEventSchema, sha256Hex, verifyProviderSignature, type ProviderEventMessage } from "@/lib/platform/events";

const maxBodyBytes = 128 * 1024;

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maxBodyBytes) return Response.json({ error: "payload_too_large", traceId }, { status: 413 });

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxBodyBytes) return Response.json({ error: "payload_too_large", traceId }, { status: 413 });

  const timestamp = request.headers.get("x-aurel-timestamp") ?? "";
  const signature = request.headers.get("x-aurel-signature") ?? "";
  const secret = env.PROVIDER_WEBHOOK_SECRET;
  if (!secret || !await verifyProviderSignature({ rawBody, timestamp, signature, secret, toleranceSeconds: Number(env.PROVIDER_WEBHOOK_TOLERANCE_SECONDS) || 300 })) {
    console.error(JSON.stringify({ message: "provider webhook signature rejected", traceId }));
    return Response.json({ error: "invalid_signature", traceId }, { status: 401 });
  }

  try {
    const event = providerEventSchema.parse(JSON.parse(rawBody));
    const receivedAt = new Date().toISOString();
    const payloadSha256 = await sha256Hex(rawBody);
    const inserted = await env.PROJECTION_DB.prepare(`
      INSERT OR IGNORE INTO webhook_receipts
      (event_id, provider, event_type, subject_reference, payload_sha256, provider_created_at, received_at, processing_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'received')
    `).bind(event.id, event.provider, event.type, event.subjectReference ?? null, payloadSha256, event.createdAt, receivedAt).run();

    if ((inserted.meta.changes ?? 0) === 0) return Response.json({ accepted: true, duplicate: true, eventId: event.id, traceId });

    const message: ProviderEventMessage = { event, receivedAt, payloadSha256 };
    try {
      await env.PROVIDER_EVENTS.send(message, { contentType: "json" });
      await env.PROJECTION_DB.prepare("UPDATE webhook_receipts SET processing_status = 'enqueued' WHERE event_id = ?").bind(event.id).run();
    } catch (queueError) {
      await env.PROJECTION_DB.prepare("DELETE FROM webhook_receipts WHERE event_id = ? AND processing_status = 'received'").bind(event.id).run();
      throw queueError;
    }

    console.log(JSON.stringify({ message: "provider webhook enqueued", traceId, eventId: event.id, provider: event.provider, eventType: event.type }));
    return Response.json({ accepted: true, duplicate: false, eventId: event.id, traceId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook failure";
    console.error(JSON.stringify({ message: "provider webhook failed", traceId, error: message }));
    return Response.json({ error: "invalid_event", traceId }, { status: 400 });
  }
}
