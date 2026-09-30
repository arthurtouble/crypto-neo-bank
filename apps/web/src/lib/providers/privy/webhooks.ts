import { z } from "zod";
import { verifySvix, type WebhookProvider } from "../webhooks";

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

export const privyWebhooks: WebhookProvider = { name: "privy", secret: () => process.env.PRIVY_WEBHOOK_SECRET, verify: verifySvix, normalize };
