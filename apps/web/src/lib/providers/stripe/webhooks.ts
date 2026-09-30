import { z } from "zod";
import { formatCents } from "@/lib/money/format";
import { hmacSha256Hex } from "@/lib/platform/encoding";
import { timingSafeEqual, type NormalizedEvent, type WebhookProvider } from "../webhooks";
import { cardProjectionStatus } from "./issuing";

const TOLERANCE_MS = 5 * 60_000;

/**
 * Stripe signs `<timestamp>.<raw body>` with HMAC-SHA256 and the endpoint's
 * `whsec_` secret. Header: `Stripe-Signature: t=<seconds>,v1=<hex>[,v1=…]`.
 * Other schemes (test events add `v0`) are ignored.
 */
async function verify({ headers, rawBody, secret, nowMs }: { headers: Headers; rawBody: string; secret: string; nowMs: number }) {
  const header = headers.get("stripe-signature") ?? "";
  const parts = header.split(",").map((part) => part.trim().split("=", 2) as [string, string]).filter((part) => part.length === 2);
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length || Math.abs(nowMs - Number(timestamp) * 1000) > TOLERANCE_MS) return false;
  const expected = new TextEncoder().encode(await hmacSha256Hex(secret, `${timestamp}.${rawBody}`));
  return signatures.some((signature) => timingSafeEqual(new TextEncoder().encode(signature), expected));
}

const eventSchema = z.object({ id: z.string().startsWith("evt_"), type: z.string(), created: z.number().int(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }).passthrough() }).passthrough();

/**
 * Card events. A card change updates the customer's card record; an
 * authorization becomes a card-spend notice. Everything else is recorded and
 * acknowledged.
 */
function normalize(payload: unknown): NormalizedEvent | null {
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) return null;
  const event = parsed.data;
  const object = event.data.object;
  const text = (value: unknown) => typeof value === "string" ? value : undefined;
  const id = (value: unknown) => text(value) ?? text((value as { id?: unknown } | null)?.id);
  const base = { id: `stripe:${event.id}`, providerObjectId: text(object.id) ?? event.id, createdAt: new Date(event.created * 1000).toISOString() };
  if (event.type === "issuing_card.created" || event.type === "issuing_card.updated") {
    const cardId = text(object.id);
    const status = text(object.status);
    const last4 = text(object.last4);
    if (!cardId || !status) return null;
    const limits = (object.spending_controls as { spending_limits?: Array<{ amount: number; interval: string }> } | undefined)?.spending_limits ?? [];
    const daily = limits.find((limit) => limit.interval === "daily");
    return { ...base, type: "card.account.updated", subject: { kind: "provider_card", value: cardId },
      data: { cardReference: cardId, customerReference: id(object.cardholder) ?? "unknown", status: cardProjectionStatus(status),
        formFactor: text(object.type) === "physical" ? "physical" : "virtual", network: "visa", ...(last4 ? { lastFour: last4 } : {}),
        ...(daily ? { dailyLimit: formatCents(daily.amount) } : {}), currency: "USD" } };
  }
  if (event.type === "issuing_authorization.created") {
    const cardId = id(object.card);
    if (!cardId) return null;
    const merchant = (object.merchant_data as { name?: string } | undefined)?.name ?? null;
    return { ...base, type: "card.authorization.created", subject: { kind: "provider_card", value: cardId },
      data: { authorizationId: text(object.id), amountCents: typeof object.amount === "number" ? object.amount : null, approved: object.approved === true, merchant } };
  }
  if (event.type === "issuing_transaction.created") {
    const cardId = id(object.card);
    if (!cardId || typeof object.amount !== "number") return null;
    const merchant = (object.merchant_data as { name?: string } | undefined)?.name ?? null;
    return { ...base, type: "card.transaction.created", subject: { kind: "provider_card", value: cardId },
      data: { transactionId: text(object.id), authorizationId: id(object.authorization) ?? null, amountCents: object.amount,
        refund: text(object.type) === "refund", merchant } };
  }
  const cardId = id(object.card);
  return { ...base, type: `stripe.${event.type}`, data: {}, subject: cardId ? { kind: "provider_card", value: cardId } : null };
}

export const stripeWebhooks: WebhookProvider = { name: "stripe", secret: () => process.env.STRIPE_WEBHOOK_SECRET, verify, normalize };
