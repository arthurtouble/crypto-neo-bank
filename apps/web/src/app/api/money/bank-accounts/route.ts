import { env } from "cloudflare:workers";
import { z } from "zod";
import { DEFAULT_NEW_RECIPIENT_DELAY_SECONDS } from "@/lib/actions/controls";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { announce } from "@/lib/notifications/deliver";
import { securityNotice } from "@/lib/notifications/store";
import { errorResponse, route, readJsonBody } from "@/lib/http/route";
import { activeBridgeCustomer, addBankAccount, bankAccountInputSchema, bridgeClient, removeBankAccount } from "@/lib/providers/bridge";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/** Save a bank account for payouts. Account details go to Bridge; Aura keeps a reference and the last four digits. */
export const POST = route("money.bank_accounts.post", { invalid: "invalid_bank_account", unavailable: "bank_account_unavailable" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "bank_account_create", subject: subject.subjectReference, limit: 5, windowSeconds: 3600 });
  const bridge = await bridgeClient(env.PROJECTION_DB);
  if (!bridge) return errorResponse(503, "feature_unavailable", context, { message: "Bank payouts aren't available yet." });
  const input = bankAccountInputSchema.parse(await readJsonBody(request));
  const customerId = await activeBridgeCustomer(env.PROJECTION_DB, subject.subjectReference);
  if (!customerId) return errorResponse(409, "verification_required", context, { message: "Finish bank account setup first." });
  const account = await addBankAccount(bridge, customerId, input, crypto.randomUUID());
  const at = new Date();
  const now = at.toISOString();
  const beneficiaryId = crypto.randomUUID();
  // Saving an account that was removed earlier counts as new: it waits again and is announced again.
  const earlier = await env.PROJECTION_DB.prepare(`SELECT verification_status FROM bank_beneficiary_projections
    WHERE subject_reference = ? AND provider = 'bridge' AND provider_beneficiary_reference = ?`).bind(subject.subjectReference, account.id).first<{ verification_status: string }>();
  // A new bank account waits like a new recipient: it can receive a payout once the customer's waiting period has passed.
  await env.PROJECTION_DB.prepare(`INSERT INTO bank_beneficiary_projections
      (beneficiary_id, subject_reference, provider, provider_beneficiary_reference, display_name, account_hint, rail, verification_status, observed_at, available_at)
    VALUES (?1, ?2, 'bridge', ?3, ?4, ?5, 'ach', 'verified', ?6, strftime('%Y-%m-%dT%H:%M:%fZ', ?6, '+' || COALESCE(
      (SELECT new_address_delay_seconds FROM security_profiles WHERE subject_reference = ?2), ${DEFAULT_NEW_RECIPIENT_DELAY_SECONDS}) || ' seconds'))
    ON CONFLICT(subject_reference, provider, provider_beneficiary_reference) DO UPDATE SET display_name = excluded.display_name, observed_at = excluded.observed_at,
      verification_status = 'verified',
      available_at = CASE WHEN bank_beneficiary_projections.verification_status = 'removed' THEN excluded.available_at ELSE bank_beneficiary_projections.available_at END`)
    .bind(beneficiaryId, subject.subjectReference, account.id, account.displayName, `•••• ${account.lastFour}`, now).run();
  const saved = await env.PROJECTION_DB.prepare(`SELECT beneficiary_id, available_at FROM bank_beneficiary_projections
    WHERE subject_reference = ? AND provider = 'bridge' AND provider_beneficiary_reference = ?`)
    .bind(subject.subjectReference, account.id).first<{ beneficiary_id: string; available_at: string | null }>();
  // A new bank account is a security event, like a new recipient (saving the same account again isn't).
  if (saved && (!earlier || earlier.verification_status === "removed")) {
    const wait = saved.available_at && saved.available_at > now ? ` It can receive from ${new Date(saved.available_at).toUTCString()}.` : "";
    await announce(env.PROJECTION_DB, subject.subjectReference,
      securityNotice("bank_account_saved", `${account.displayName} (•••• ${account.lastFour}) was saved for bank transfers.${wait}`, `${saved.beneficiary_id}:${now}`), at);
  }
  return Response.json({ bankAccount: { name: account.displayName, lastFour: account.lastFour }, traceId: context.traceId }, { status: 201 });
});

const removeSchema = z.strictObject({ bankAccountId: z.uuid() });

/**
 * Remove a saved bank account. Bridge deletes it first, so no payout can
 * reach it; then it leaves the customer's list. Payouts already sent carry on.
 */
export const DELETE = route("money.bank_accounts.delete", { invalid: "invalid_bank_account", unavailable: "bank_account_unavailable" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "bank_account_remove", subject: subject.subjectReference, limit: 10, windowSeconds: 3600 });
  const bridge = await bridgeClient(env.PROJECTION_DB);
  if (!bridge) return errorResponse(503, "feature_unavailable", context, { message: "Bank payouts aren't available yet." });
  const { bankAccountId } = removeSchema.parse(await readJsonBody(request));
  const bank = await env.PROJECTION_DB.prepare(`SELECT provider_beneficiary_reference, display_name, account_hint FROM bank_beneficiary_projections
    WHERE beneficiary_id = ? AND subject_reference = ? AND provider = 'bridge' AND verification_status != 'removed'`)
    .bind(bankAccountId, subject.subjectReference).first<{ provider_beneficiary_reference: string; display_name: string; account_hint: string | null }>();
  if (!bank) return errorResponse(404, "bank_account_not_found", context, { message: "That bank account isn't saved." });
  const customerId = await activeBridgeCustomer(env.PROJECTION_DB, subject.subjectReference);
  if (!customerId) return errorResponse(409, "verification_required", context, { message: "Finish bank account setup first." });
  await removeBankAccount(bridge, customerId, bank.provider_beneficiary_reference);
  const at = new Date();
  await env.PROJECTION_DB.prepare("UPDATE bank_beneficiary_projections SET verification_status = 'removed', observed_at = ? WHERE beneficiary_id = ? AND subject_reference = ?")
    .bind(at.toISOString(), bankAccountId, subject.subjectReference).run();
  await announce(env.PROJECTION_DB, subject.subjectReference,
    securityNotice("bank_account_removed", `${bank.display_name}${bank.account_hint ? ` (${bank.account_hint})` : ""} was removed from your bank accounts.`, bankAccountId), at);
  return Response.json({ removed: true, traceId: context.traceId });
});
