import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet } from "@/lib/auth/wallet";
import { requireUnlocked } from "@/lib/actions/controls";
import { cardsProvider, cardView, MAX_DAILY_LIMIT_USD, readCardState, refreshCardProjection, storedCardId } from "@/lib/cards/service";
import { errorResponse, route, readJsonBody } from "@/lib/http/route";
import { formatUsd } from "@/lib/format";
import { announce } from "@/lib/notifications/deliver";
import { securityNotice } from "@/lib/notifications/store";
import { getCard, updateCard } from "@/lib/providers/stripe/issuing";
import { confirmWithPasskey } from "@/lib/security/confirm";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const schema = z.strictObject({
  frozen: z.boolean().optional(),
  dailyLimitUsd: z.number().int().min(1).max(MAX_DAILY_LIMIT_USD).optional(),
  confirmation: z.strictObject({ challengeId: z.uuid(), signature: z.string().min(16).max(4096) }).optional()
}).refine((value) => value.frozen !== undefined || value.dailyLimitUsd !== undefined, "Nothing to change.");

/**
 * Freeze or unfreeze the card, or change its daily limit. Stripe applies it.
 * Freezing and lowering the limit apply at once; unfreezing and raising the
 * limit need a fresh passkey confirmation, and unfreezing needs the account
 * to be unlocked.
 */
export const PATCH = route("cards.controls", { unavailable: "card_unavailable", invalid: "invalid_card_change" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "card_controls", subject: subject.subjectReference, limit: 30, windowSeconds: 600 });
  const { confirmation, ...change } = schema.parse(await readJsonBody(request));
  const provider = await cardsProvider(env.PROJECTION_DB);
  const cardId = provider && await storedCardId(env.PROJECTION_DB, subject.subjectReference);
  if (!provider || !cardId) return errorResponse(404, "card_not_found", context, { message: "You don't have a card." });
  // Freezing alone needs nothing from the card first, so it still works when Stripe can't be read.
  const freezeOnly = change.frozen === true && change.dailyLimitUsd === undefined;
  const current = freezeOnly ? null : cardView(await getCard(provider.stripe, cardId));
  const unfreezing = change.frozen === false && current?.status === "frozen";
  const raising = change.dailyLimitUsd !== undefined && (current?.dailyLimitUsd === null || change.dailyLimitUsd > (current?.dailyLimitUsd ?? 0));
  const now = new Date();
  if (unfreezing) await requireUnlocked(env.PROJECTION_DB, subject.subjectReference, now, "Your account is locked. Unlock it in Settings first.");
  if (unfreezing || raising) {
    const reasons = [unfreezing ? "unfreeze your card" : "", raising ? `raise your card's daily limit to ${formatUsd(change.dailyLimitUsd ?? 0)}` : ""].filter(Boolean);
    const asked = await confirmWithPasskey(env.PROJECTION_DB, { subject: subject.subjectReference, purpose: "card_controls",
      payload: { cardId, change, from: { status: current?.status, dailyLimitUsd: current?.dailyLimitUsd } }, summary: reasons.join(" and "), confirmation, traceId: context.traceId });
    if (asked) return asked;
  }
  const card = await updateCard(provider.stripe, cardId, { status: change.frozen === undefined ? undefined : change.frozen ? "inactive" : "active",
    dailyLimitCents: change.dailyLimitUsd === undefined ? undefined : change.dailyLimitUsd * 100 }, crypto.randomUUID());
  await refreshCardProjection(env.PROJECTION_DB, subject.subjectReference, card, now);
  if (unfreezing) await announce(env.PROJECTION_DB, subject.subjectReference, securityNotice("card_unfrozen", `Your card ending ${card.last4} can be used again.`, `${cardId}:${now.toISOString()}`), now);
  if (raising) await announce(env.PROJECTION_DB, subject.subjectReference, securityNotice("card_limit_raised", `Your card can now spend up to ${formatUsd(change.dailyLimitUsd ?? 0)} a day.`, `${cardId}:${now.toISOString()}`), now);
  const wallet = await requireActionWallet(subject.subjectReference);
  return Response.json({ ...await readCardState(env.PROJECTION_DB, subject.subjectReference, wallet, now), traceId: context.traceId }, { headers: { "Cache-Control": "private, no-store" } });
});
