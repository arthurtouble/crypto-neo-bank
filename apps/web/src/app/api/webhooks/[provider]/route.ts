import { env } from "cloudflare:workers";
import type { ProviderEventMessage } from "@aurel/provider-projections";
import { sha256Hex } from "@/lib/platform/events";
import { webhookProviders } from "@/lib/providers/registry";
import type { NormalizedEvent } from "@/lib/providers/webhooks";
import { announce } from "@/lib/notifications/deliver";
import { cardSpendNotice } from "@/lib/notifications/store";

async function announceCardSpend(subject: string, data: Record<string, unknown>, createdAt: string) {
  const amountCents = typeof data.amountCents === "number" ? data.amountCents : 0;
  await announce(env.PROJECTION_DB, subject, cardSpendNotice({ authorizationId: String(data.authorizationId ?? ""), amountCents,
    approved: data.approved === true, merchant: typeof data.merchant === "string" ? data.merchant : null }), new Date(createdAt));
}

const MAX_BODY_BYTES = 128 * 1024;
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function resolveSubject(provider: string, subject: NormalizedEvent["subject"]): Promise<string | undefined> {
  if (!subject) return undefined;
  if (subject.kind === "subject") return subject.value;
  if (subject.kind === "provider_card") {
    const card = await env.PROJECTION_DB.prepare("SELECT subject_reference FROM card_account_projections WHERE provider = ? AND card_reference = ?")
      .bind(provider, subject.value).first<{ subject_reference: string }>();
    return card?.subject_reference;
  }
  const column = subject.kind === "provider_customer" ? "external_customer_id" : "onboarding_reference";
  const link = await env.PROJECTION_DB.prepare(`SELECT subject_reference FROM provider_customer_links WHERE provider = ? AND ${column} = ?`)
    .bind(provider, subject.value).first<{ subject_reference: string }>();
  return link?.subject_reference;
}

/**
 * Provider webhooks. Each provider's own signing scheme is checked against the
 * raw body before anything is parsed; the provider comes from the URL, never
 * from the payload. Accepted events are recorded once and queued for projection.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const traceId = crypto.randomUUID();
  const name = (await params).provider;
  const provider = Object.hasOwn(webhookProviders, name) ? webhookProviders[name] : undefined;
  if (!provider) return reply(404, { error: "unknown_provider", traceId });
  const secret = provider.secret();
  if (!secret) return reply(503, { error: "provider_not_connected", traceId });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return reply(413, { error: "payload_too_large", traceId });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return reply(413, { error: "payload_too_large", traceId });
  if (!await provider.verify({ headers: request.headers, rawBody, secret, nowMs: Date.now() })) {
    console.warn(JSON.stringify({ event: "webhook.signature_rejected", provider: provider.name, traceId }));
    return reply(401, { error: "invalid_signature", traceId });
  }
  let normalized: NormalizedEvent | null;
  try { normalized = provider.normalize(JSON.parse(rawBody), request.headers); }
  catch { normalized = null; }
  if (!normalized) return reply(400, { error: "invalid_event", traceId });

  const event = { id: normalized.id, provider: provider.name, type: normalized.type, providerObjectId: normalized.providerObjectId,
    createdAt: normalized.createdAt, data: normalized.data, subjectReference: await resolveSubject(provider.name, normalized.subject) };
  const receivedAt = new Date().toISOString();
  const payloadSha256 = await sha256Hex(rawBody);
  const inserted = await env.PROJECTION_DB.prepare(`INSERT OR IGNORE INTO webhook_receipts
      (event_id, provider, event_type, subject_reference, payload_sha256, provider_created_at, received_at, processing_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'received')`)
    .bind(event.id, event.provider, event.type, event.subjectReference ?? null, payloadSha256, event.createdAt, receivedAt).run();
  if (!inserted.meta.changes) return reply(200, { accepted: true, duplicate: true, traceId });
  // A card purchase is told to the customer straight away; the notice isn't a projection of money.
  if (event.type === "card.authorization.created" && event.subjectReference) await announceCardSpend(event.subjectReference, event.data, event.createdAt);
  const message: ProviderEventMessage = { event, receivedAt, payloadSha256 };
  try {
    await env.PROVIDER_EVENTS.send(message, { contentType: "json" });
    await env.PROJECTION_DB.prepare("UPDATE webhook_receipts SET processing_status = 'enqueued' WHERE event_id = ?").bind(event.id).run();
  } catch (error) {
    // Let the provider retry: forget the receipt so the retry is not treated as a duplicate.
    await env.PROJECTION_DB.prepare("DELETE FROM webhook_receipts WHERE event_id = ? AND processing_status = 'received'").bind(event.id).run();
    throw error;
  }
  return reply(202, { accepted: true, duplicate: false, traceId });
}
