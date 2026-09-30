import { env } from "cloudflare:workers";
import { claimProviderCommand, settleProviderCommand } from "@aurel/provider-projections";
import { z } from "zod";
import { buildPayoutFunding } from "@/lib/actions/payout";
import { precheckAction, prepareBuiltAction, requireAllowed } from "@/lib/actions/prepare";
import { ACTION_TTL_MS, getAction } from "@/lib/actions/store";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireMoneyAccount } from "@/lib/auth/wallet";
import { errorResponse, route, readJsonBody } from "@/lib/http/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { sha256Hex } from "@/lib/platform/encoding";
import { activeBridgeCustomer, BridgeError, bridgeClient, createPayout } from "@/lib/providers/bridge";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { actionView } from "../../actions/view";

const schema = z.strictObject({ bankAccountId: z.uuid(), amountUsd: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/), rail: z.enum(["ach", "wire"]).default("ach") });

/**
 * Send money to a saved bank account. Bridge creates the payout and names a
 * Base address; Aura prepares the USDC transfer to it as an ordinary action,
 * under the customer's lock and daily limit. Everything that would refuse the
 * action is checked before Bridge is asked, and one payout request is claimed
 * for the action's signing window, so a retry never creates a second payout.
 */
export const POST = route("money.payouts.post", { invalid: "invalid_payout", unavailable: "payout_unavailable" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "bank_payout", subject: subject.subjectReference, limit: 10, windowSeconds: 3600 });
  const bridge = await bridgeClient(env.PROJECTION_DB);
  if (!bridge) return errorResponse(503, "feature_unavailable", context, { message: "Bank payouts aren't available yet." });
  const input = schema.parse(await readJsonBody(request));
  if (Number(input.amountUsd) <= 0) return errorResponse(422, "invalid_amount", context, { message: "Enter an amount greater than zero." });
  const [customerId, bank] = await Promise.all([
    activeBridgeCustomer(env.PROJECTION_DB, subject.subjectReference),
    env.PROJECTION_DB.prepare(`SELECT beneficiary_id, provider_beneficiary_reference, display_name, account_hint FROM bank_beneficiary_projections
      WHERE beneficiary_id = ? AND subject_reference = ? AND provider = 'bridge' AND verification_status = 'verified'`)
      .bind(input.bankAccountId, subject.subjectReference).first<{ beneficiary_id: string; provider_beneficiary_reference: string; display_name: string; account_hint: string | null }>()
  ]);
  if (!customerId) return errorResponse(409, "verification_required", context, { message: "Finish bank account setup first." });
  if (!bank) return errorResponse(404, "bank_account_not_found", context, { message: "Choose a saved bank account." });
  const { address: wallet } = await requireMoneyAccount(subject.subjectReference);
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const destination = { id: bank.beneficiary_id, displayName: bank.display_name, lastFour: bank.account_hint?.slice(-4) ?? null };
  // Check everything the funding action needs before Bridge creates anything: the switch, the asset's pause, and the
  // customer's controls. The deposit address does not affect them.
  const draft = buildPayoutFunding({ transferId: "", depositAddress: wallet, amount: input.amountUsd }, destination);
  await requireAllowed(env.PROJECTION_DB, ["fiat_accounts"], draft.valuation.assetId);
  const blocked = await precheckAction(env.PROJECTION_DB, subject.subjectReference, draft);
  if (blocked) return errorResponse(409, blocked.code, context, { message: blocked.message });

  // The same payout (account, amount, rail) is claimed once per signing window: a retry gets the first answer.
  const now = new Date();
  const claim = await claimProviderCommand(env.PROJECTION_DB, { subjectReference: subject.subjectReference, commandType: "bank_payout", provider: "bridge",
    idempotencyKey: `${bank.beneficiary_id}:${draft.valuation.amountRaw}:${input.rail}`, ttlSeconds: ACTION_TTL_MS / 1000, now });
  if (claim.outcome !== "claimed") {
    const earlier = claim.providerObjectId ? await getAction(env.PROJECTION_DB, subject.subjectReference, claim.providerObjectId) : null;
    if (earlier?.status === "prepared")
      return Response.json({ action: actionView(earlier), traceId: context.traceId }, { status: 200 });
    return errorResponse(409, "payout_in_progress", context, { message: "You just asked for this payout. Check Transactions, or try again in a few minutes." });
  }
  let payout;
  try {
    payout = await createPayout(bridge, { customerId, externalAccountId: bank.provider_beneficiary_reference, amountUsd: input.amountUsd,
      fromAddress: wallet, rail: input.rail, requestId: (await sha256Hex(`${claim.key}:${now.toISOString()}`)).slice(0, 32) });
  } catch (error) {
    // Bridge refused it, so nothing was created and the customer can try again. Anything else keeps the claim until it expires.
    if (error instanceof BridgeError && error.status >= 400 && error.status < 500) await settleProviderCommand(env.PROJECTION_DB, claim.key, { status: "failed" });
    throw error;
  }
  const prepared = await prepareBuiltAction(env.PROJECTION_DB, subject.subjectReference, wallet, buildPayoutFunding(payout, destination), () => "fiat_accounts");
  if (!prepared.ok) {
    await settleProviderCommand(env.PROJECTION_DB, claim.key, { status: "failed" });
    return errorResponse(409, prepared.block.code, context, { message: prepared.block.message });
  }
  await settleProviderCommand(env.PROJECTION_DB, claim.key, { status: "completed", providerObjectId: prepared.action.id });
  return Response.json({ action: actionView(prepared.action), traceId: context.traceId }, { status: 201 });
});
