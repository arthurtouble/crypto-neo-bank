import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { cardsProvider, storedCardId } from "@/lib/cards/service";
import { errorResponse, route, readJsonBody } from "@/lib/http/route";
import { listTransactions, openDispute } from "@/lib/providers/stripe/issuing";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const schema = z.strictObject({ transactionId: z.string().startsWith("ipi_").max(80),
  reason: z.enum(["fraudulent", "not_received", "duplicate", "canceled", "other"]), explanation: z.string().trim().min(10).max(1000) });

/**
 * Dispute a settled card payment. Stripe files it with Visa; a dispute can be
 * submitted once. Credits and refunds from a dispute go back to the account's
 * USDC on Base.
 */
export const POST = route("cards.disputes", { unavailable: "dispute_unavailable", invalid: "invalid_dispute" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "card_dispute", subject: subject.subjectReference, limit: 10, windowSeconds: 86_400 });
  const input = schema.parse(await readJsonBody(request));
  const provider = await cardsProvider(env.PROJECTION_DB);
  const cardId = provider && await storedCardId(env.PROJECTION_DB, subject.subjectReference);
  if (!provider || !cardId) return errorResponse(404, "card_not_found", context, { message: "You don't have a card." });
  // Only the customer's own card's payments can be disputed.
  const transaction = (await listTransactions(provider.stripe, cardId, 100)).find((item) => item.id === input.transactionId);
  if (!transaction || transaction.type !== "capture") return errorResponse(404, "transaction_not_found", context, { message: "Choose one of your card payments." });
  if (transaction.dispute) return errorResponse(409, "already_disputed", context, { message: "This payment is already disputed." });
  const dispute = await openDispute(provider.stripe, { transactionId: transaction.id, reason: input.reason, explanation: input.explanation, requestId: crypto.randomUUID() });
  return Response.json({ dispute: { id: dispute.id, status: dispute.status }, traceId: context.traceId }, { status: 201 });
});
