import { env } from "cloudflare:workers";
import { z } from "zod";
import { buildCardAllowance } from "@/lib/actions/card-allowance";
import { prepareBuiltAction } from "@/lib/actions/prepare";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireMoneyAccount } from "@/lib/auth/wallet";
import { cardsProvider, storedCardId } from "@/lib/cards/service";
import { errorResponse, route } from "@/lib/http/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { actionView } from "../../actions/view";

const schema = z.strictObject({ amountUsd: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/) });

/**
 * Prepare the approval that lets the card spend up to this much of the
 * account's USDC. The customer signs it like any action, with their passkey
 * and under the account lock; 0 turns card spending off on chain.
 */
export const POST = route("cards.allowance", { unavailable: "card_unavailable", invalid: "invalid_allowance" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "card_allowance", subject: subject.subjectReference, limit: 20, windowSeconds: 3600 });
  const input = schema.parse(await request.json());
  const provider = await cardsProvider(env.PROJECTION_DB);
  if (!provider || !await storedCardId(env.PROJECTION_DB, subject.subjectReference)) return errorResponse(404, "card_not_found", context, { message: "You don't have a card." });
  const { address: wallet } = await requireMoneyAccount(subject.subjectReference);
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  if (Number(input.amountUsd) === 0) return errorResponse(422, "invalid_amount", context, { message: "Enter an amount greater than zero, or freeze the card." });
  const prepared = await prepareBuiltAction(env.PROJECTION_DB, subject.subjectReference, wallet, buildCardAllowance(provider.spender, input.amountUsd), () => "payment_cards");
  if (!prepared.ok) return errorResponse(409, prepared.block.code, context, { message: prepared.block.message });
  return Response.json({ action: actionView(prepared.action), traceId: context.traceId }, { status: 201 });
});
