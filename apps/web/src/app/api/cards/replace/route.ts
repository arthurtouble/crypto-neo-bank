import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireMoneyAccount } from "@/lib/auth/wallet";
import { requireUnlocked } from "@/lib/actions/controls";
import { cardsProvider, cardView, DEFAULT_DAILY_LIMIT_USD, readCardState, recordCard, refreshCardProjection, storedCardId } from "@/lib/cards/service";
import { errorResponse, route, readJsonBody } from "@/lib/http/route";
import { announce } from "@/lib/notifications/deliver";
import { securityNotice } from "@/lib/notifications/store";
import { createCard, getCard, updateCard } from "@/lib/providers/stripe/issuing";
import { confirmWithPasskey } from "@/lib/security/confirm";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const schema = z.strictObject({
  cardId: z.string().startsWith("ic_").max(80),
  reason: z.enum(["lost", "stolen"]),
  confirmation: z.strictObject({ challengeId: z.uuid(), signature: z.string().min(16).max(4096) }).optional()
});

/**
 * Replace a lost or stolen card: Stripe cancels it for good, then issues a
 * new virtual card with a new number on the same cardholder, keeping the daily
 * limit. The allowance belongs to the account, not the card, so it carries
 * over. Needs a fresh passkey confirmation and an unlocked account. The
 * request names the card being replaced, so a repeat never replaces the new one.
 */
export const POST = route("cards.replace", { unavailable: "card_unavailable", invalid: "invalid_card_change" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "card_replace", subject: subject.subjectReference, limit: 6, windowSeconds: 86_400 });
  const { cardId, reason, confirmation } = schema.parse(await readJsonBody(request));
  const provider = await cardsProvider(env.PROJECTION_DB);
  const current = provider && await storedCardId(env.PROJECTION_DB, subject.subjectReference);
  if (!provider || !current) return errorResponse(404, "card_not_found", context, { message: "You don't have a card." });
  if (current !== cardId) return errorResponse(409, "card_already_replaced", context, { message: "This card was already replaced." });
  const now = new Date();
  await requireUnlocked(env.PROJECTION_DB, subject.subjectReference, now, "Your account is locked. Unlock it in Settings first.");
  const asked = await confirmWithPasskey(env.PROJECTION_DB, { subject: subject.subjectReference, purpose: "card_controls", payload: { replace: cardId, reason },
    summary: "cancel your card and get a new one", confirmation, traceId: context.traceId });
  if (asked) return asked;
  const { address: wallet } = await requireMoneyAccount(subject.subjectReference);
  const row = await env.PROJECTION_DB.prepare("SELECT provider_customer_reference FROM card_account_projections WHERE card_reference = ? AND subject_reference = ?")
    .bind(cardId, subject.subjectReference).first<{ provider_customer_reference: string }>();
  if (!row?.provider_customer_reference) return errorResponse(409, "card_approval_required", context, { message: "Apply for a card first." });
  const old = await getCard(provider.stripe, cardId);
  const dailyLimitUsd = cardView(old).dailyLimitUsd ?? DEFAULT_DAILY_LIMIT_USD;
  // Cancel first: a stolen card must stop working even if the new one can't be made right now.
  const canceled = await updateCard(provider.stripe, cardId, { status: "canceled", cancellationReason: reason }, `replace:${cardId}`);
  await refreshCardProjection(env.PROJECTION_DB, subject.subjectReference, canceled, now);
  const card = await createCard(provider.stripe, { cardholderId: row.provider_customer_reference, wallet, dailyLimitCents: dailyLimitUsd * 100,
    requestId: `replace:${cardId}`, replacing: { cardId, reason } });
  await recordCard(env.PROJECTION_DB, subject.subjectReference, row.provider_customer_reference, card, now);
  await announce(env.PROJECTION_DB, subject.subjectReference,
    securityNotice("card_replaced", `Your card ending ${old.last4} was canceled. Your new card ends ${card.last4}.`, card.id), now);
  return Response.json({ ...await readCardState(env.PROJECTION_DB, subject.subjectReference, wallet, now), traceId: context.traceId }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
});
