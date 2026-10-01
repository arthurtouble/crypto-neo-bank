import { z } from "zod";
import { base64ToBytes } from "@/lib/platform/encoding";
import type { WebhookProvider } from "../webhooks";

const TOLERANCE_MS = 10 * 60_000;

const eventSchema = z.object({
  event_id: z.string().min(1).max(200),
  event_category: z.string().min(1).max(80),
  event_type: z.string().min(1).max(120),
  event_object_id: z.string().min(1).max(200),
  event_object: z.record(z.string(), z.unknown()),
  event_object_status: z.string().nullable().optional(),
  event_created_at: z.string()
}).passthrough();

function pemToSpki(pem: string): Uint8Array {
  return base64ToBytes(pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, ""));
}

/**
 * Bridge signs `<timestamp>.<raw body>` with RSA. Its reference code signs the
 * SHA-256 digest of that string with RSA-SHA256, so the digest is hashed again here.
 * Header: `X-Webhook-Signature: t=<ms>,v0=<base64>`.
 */
async function verify({ headers, rawBody, secret, nowMs }: { headers: Headers; rawBody: string; secret: string; nowMs: number }) {
  const header = headers.get("x-webhook-signature") ?? "";
  const parts = Object.fromEntries(header.split(",").map((part) => part.trim().split("=", 2) as [string, string]).filter((part) => part.length === 2));
  const timestamp = Number(parts.t);
  if (!parts.t || !parts.v0 || !Number.isSafeInteger(timestamp) || Math.abs(nowMs - timestamp) > TOLERANCE_MS) return false;
  try {
    const key = await crypto.subtle.importKey("spki", pemToSpki(secret) as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${parts.t}.${rawBody}`));
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64ToBytes(parts.v0) as BufferSource, digest);
  } catch { return false; }
}

/**
 * Customer, KYC-link, and transfer events update Aura's projections. Other
 * categories (virtual account activity, cards) are recorded and acknowledged
 * until their projections exist. Event types are `<category>.<mutation>`, and
 * `event_object` has the same shape as the matching API object.
 */
function normalize(payload: unknown) {
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) return null;
  const event = parsed.data;
  const object = event.event_object;
  const text = (value: unknown) => typeof value === "string" ? value : undefined;
  // An event without a readable time can't be ordered against the stored projection: reject it rather than date it now.
  if (Number.isNaN(Date.parse(event.event_created_at))) return null;
  const createdAt = new Date(event.event_created_at).toISOString();
  const base = { id: `bridge:${event.event_id}`, providerObjectId: event.event_object_id, createdAt };
  if (event.event_category === "customer") {
    const status = text(object.status) ?? event.event_object_status ?? undefined;
    if (!status) return null;
    return { ...base, type: "provider.customer.updated", data: { status }, subject: { kind: "provider_customer" as const, value: event.event_object_id } };
  }
  if (event.event_category === "kyc_link") {
    return { ...base, type: "provider.customer.updated",
      data: { kycStatus: text(object.kyc_status), tosStatus: text(object.tos_status), customerId: text(object.customer_id) },
      subject: { kind: "provider_onboarding" as const, value: event.event_object_id } };
  }
  const customer = text(object.on_behalf_of) ?? text(object.customer_id);
  if (event.event_category === "transfer" && customer && text(object.state)) {
    return { ...base, type: "bank.payout.updated", data: { transferId: event.event_object_id, state: text(object.state) },
      subject: { kind: "provider_customer" as const, value: customer } };
  }
  return { ...base, type: `bridge.${event.event_category}`, data: {},
    subject: customer ? { kind: "provider_customer" as const, value: customer } : null };
}

export const bridgeWebhooks: WebhookProvider = { name: "bridge", secret: () => process.env.BRIDGE_WEBHOOK_PUBLIC_KEY, verify, normalize };
