import { z } from "zod";
import { base64ToBytes, timingSafeEqual, type WebhookProvider } from "../webhooks";

const TOLERANCE_MS = 5 * 60_000;

/**
 * Privy delivers webhooks through Svix: HMAC-SHA256 over `<id>.<timestamp>.<body>`
 * with the base64 part of the `whsec_` secret. `svix-signature` may list several `v1,<sig>` values.
 */
async function verify({ headers, rawBody, secret, nowMs }: { headers: Headers; rawBody: string; secret: string; nowMs: number }) {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp) || Math.abs(nowMs - Number(timestamp) * 1000) > TOLERANCE_MS) return false;
  try {
    const key = await crypto.subtle.importKey("raw", base64ToBytes(secret.replace(/^whsec_/, "")) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)));
    return signatures.split(" ").some((entry) => {
      const [version, value] = entry.split(",", 2);
      try { return version === "v1" && Boolean(value) && timingSafeEqual(base64ToBytes(value), expected); } catch { return false; }
    });
  } catch { return false; }
}

const eventSchema = z.object({ type: z.string().min(1).max(120), user: z.object({ id: z.string().min(3).max(160) }).passthrough().optional() }).passthrough();

/** Privy events are recorded and acknowledged; none of them changes a projection yet. */
function normalize(payload: unknown, headers: Headers) {
  const parsed = eventSchema.safeParse(payload);
  const messageId = headers.get("svix-id");
  if (!parsed.success || !messageId) return null;
  const userId = parsed.data.user?.id;
  return { id: `privy:${messageId}`, type: `privy.${parsed.data.type}`, providerObjectId: userId ?? parsed.data.type,
    createdAt: new Date().toISOString(), data: {}, subject: userId ? { kind: "subject" as const, value: userId } : null };
}

export const privyWebhooks: WebhookProvider = { name: "privy", secret: () => process.env.PRIVY_WEBHOOK_SECRET, verify, normalize };
