import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { cardsProvider, storedCardId } from "@/lib/cards/service";
import { errorResponse, route } from "@/lib/http/route";
import { createEphemeralKey } from "@/lib/providers/stripe/issuing";
import { confirmWithPasskey } from "@/lib/security/confirm";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const schema = z.strictObject({ nonce: z.string().min(8).max(512),
  confirmation: z.strictObject({ challengeId: z.uuid(), signature: z.string().min(16).max(4096) }).optional() });

/**
 * A 15-minute key for Stripe's own frames to show this customer's card
 * number, expiry, and security code, or to add it to a phone wallet. Only for
 * the customer's own card, and only after a fresh passkey confirmation: a
 * session alone never reveals the card. The number never passes through Aura.
 */
export const POST = route("cards.details_key", { unavailable: "card_unavailable", invalid: "invalid_request" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "card_details", subject: subject.subjectReference, limit: 20, windowSeconds: 3600 });
  const { nonce, confirmation } = schema.parse(await request.json());
  const provider = await cardsProvider(env.PROJECTION_DB);
  const cardId = provider && await storedCardId(env.PROJECTION_DB, subject.subjectReference);
  if (!provider || !cardId) return errorResponse(404, "card_not_found", context, { message: "You don't have a card." });
  const asked = await confirmWithPasskey(env.PROJECTION_DB, { subject: subject.subjectReference, purpose: "card_details", payload: { cardId, nonce },
    summary: "show your card details", confirmation, traceId: context.traceId });
  if (asked) return asked;
  return Response.json({ cardId, ephemeralKeySecret: await createEphemeralKey(provider.stripe, cardId, nonce), traceId: context.traceId },
    { headers: { "Cache-Control": "no-store" } });
});
