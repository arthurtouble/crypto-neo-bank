import { env } from "cloudflare:workers";
import { z } from "zod";
import { buildPayoutFunding } from "@/lib/actions/payout";
import { precheckAction, prepareBuiltAction } from "@/lib/actions/prepare";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet } from "@/lib/auth/wallet";
import { errorResponse, route } from "@/lib/http/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { bridgeClient, createPayout } from "@/lib/providers/bridge";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { actionView } from "../../actions/view";

const schema = z.strictObject({ bankAccountId: z.uuid(), amountUsd: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/), rail: z.enum(["ach", "wire"]).default("ach") });

/**
 * Send money to a saved bank account. Bridge creates the payout and names a
 * Base address; Aura prepares the USDC transfer to it as an ordinary action,
 * under the customer's lock and daily limit.
 */
export const POST = route("money.payouts.post", { invalid: "invalid_payout", unavailable: "payout_unavailable" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "bank_payout", subject: subject.subjectReference, limit: 10, windowSeconds: 3600 });
  const bridge = await bridgeClient(env.PROJECTION_DB);
  if (!bridge) return errorResponse(503, "feature_unavailable", context, { message: "Bank payouts aren't available yet." });
  const input = schema.parse(await request.json());
  if (Number(input.amountUsd) <= 0) return errorResponse(422, "invalid_amount", context, { message: "Enter an amount greater than zero." });
  const [link, bank] = await Promise.all([
    env.PROJECTION_DB.prepare("SELECT external_customer_id FROM provider_customer_links WHERE subject_reference = ? AND provider = 'bridge' AND status = 'active' AND external_customer_id IS NOT NULL")
      .bind(subject.subjectReference).first<{ external_customer_id: string }>(),
    env.PROJECTION_DB.prepare(`SELECT beneficiary_id, provider_beneficiary_reference, display_name, account_hint FROM bank_beneficiary_projections
      WHERE beneficiary_id = ? AND subject_reference = ? AND provider = 'bridge' AND verification_status = 'verified'`)
      .bind(input.bankAccountId, subject.subjectReference).first<{ beneficiary_id: string; provider_beneficiary_reference: string; display_name: string; account_hint: string | null }>()
  ]);
  if (!link) return errorResponse(409, "verification_required", context, { message: "Finish bank account setup first." });
  if (!bank) return errorResponse(404, "bank_account_not_found", context, { message: "Choose a saved bank account." });
  const wallet = await requireActionWallet(subject.subjectReference);
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const destination = { id: bank.beneficiary_id, displayName: bank.display_name, lastFour: bank.account_hint?.slice(-4) ?? null };
  // Check the customer's controls before Bridge creates anything; the deposit address does not affect them.
  const blocked = await precheckAction(env.PROJECTION_DB, subject.subjectReference,
    buildPayoutFunding({ transferId: "", depositAddress: wallet, amount: input.amountUsd }, destination));
  if (blocked) return errorResponse(409, blocked.code, context, { message: blocked.message });
  const payout = await createPayout(bridge, { customerId: link.external_customer_id, externalAccountId: bank.provider_beneficiary_reference,
    amountUsd: input.amountUsd, fromAddress: wallet, rail: input.rail, requestId: crypto.randomUUID() });
  const prepared = await prepareBuiltAction(env.PROJECTION_DB, subject.subjectReference, wallet, buildPayoutFunding(payout, destination), () => "fiat_accounts");
  if (!prepared.ok) return errorResponse(409, prepared.block.code, context, { message: prepared.block.message });
  return Response.json({ action: actionView(prepared.action), traceId: context.traceId }, { status: 201 });
});
