import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet, requireMoneyAccount } from "@/lib/auth/wallet";
import { requireUnlocked } from "@/lib/actions/controls";
import { cardsProvider, DEFAULT_DAILY_LIMIT_USD, readCardState, recordCard, storedCardId } from "@/lib/cards/service";
import { errorResponse, route } from "@/lib/http/route";
import { announce } from "@/lib/notifications/deliver";
import { securityNotice } from "@/lib/notifications/store";
import { activeBridgeCustomer, bridgeClient } from "@/lib/providers/bridge";
import { readCardsApproval } from "@/lib/providers/bridge/cards";
import { createCard } from "@/lib/providers/stripe/issuing";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const noStore = { "Cache-Control": "private, no-store" };

/** The customer's card, its allowance and recent spending, or the next step to get one. */
export const GET = route("cards.get", { unavailable: "card_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const wallet = await requireActionWallet(subject.subjectReference);
  return Response.json({ ...await readCardState(env.PROJECTION_DB, subject.subjectReference, wallet), traceId }, { headers: noStore });
});

/**
 * Create the customer's virtual card, once Bridge has approved them for
 * cards. One card per account. It needs a passkey on the account and an
 * unlocked account, and starts with a 500 USD daily limit.
 */
export const POST = route("cards.create", { unavailable: "card_unavailable" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "card_create", subject: subject.subjectReference, limit: 5, windowSeconds: 3600 });
  const [provider, bridge] = await Promise.all([cardsProvider(env.PROJECTION_DB), bridgeClient(env.PROJECTION_DB)]);
  if (!provider || !bridge) return errorResponse(503, "feature_unavailable", context, { message: "Cards aren't available yet." });
  const { address: wallet } = await requireMoneyAccount(subject.subjectReference);
  const now = new Date();
  await requireUnlocked(env.PROJECTION_DB, subject.subjectReference, now);
  if (await storedCardId(env.PROJECTION_DB, subject.subjectReference)) return errorResponse(409, "card_exists", context, { message: "You already have a card." });
  const customer = await activeBridgeCustomer(env.PROJECTION_DB, subject.subjectReference);
  if (!customer) return errorResponse(409, "verification_required", context, { message: "Verify your identity on Deposit first." });
  const approval = await readCardsApproval(bridge, customer);
  if (approval.status !== "approved" || !approval.cardholderId) return errorResponse(409, "card_approval_required", context, { message: "Apply for a card first." });
  // One request ID per cardholder: a double submit gets Stripe's first answer back, not a second card.
  const card = await createCard(provider.stripe, { cardholderId: approval.cardholderId, wallet, dailyLimitCents: DEFAULT_DAILY_LIMIT_USD * 100,
    requestId: `${subject.subjectReference}:${approval.cardholderId}` });
  await recordCard(env.PROJECTION_DB, subject.subjectReference, approval.cardholderId, card, now);
  await announce(env.PROJECTION_DB, subject.subjectReference, securityNotice("card_created", `Your virtual Visa card ending ${card.last4} was created.`, card.id), now);
  return Response.json({ ...await readCardState(env.PROJECTION_DB, subject.subjectReference, wallet, now), traceId: context.traceId }, { status: 201, headers: noStore });
});
