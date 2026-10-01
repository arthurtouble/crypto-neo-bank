import { env } from "cloudflare:workers";
import { DEFAULT_NEW_RECIPIENT_DELAY_SECONDS } from "@/lib/actions/controls";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { announce } from "@/lib/notifications/deliver";
import { securityNotice } from "@/lib/notifications/store";
import { errorResponse, route, readJsonBody } from "@/lib/http/route";
import { activeBridgeCustomer, addBankAccount, bankAccountInputSchema, bridgeClient } from "@/lib/providers/bridge";
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
  // A new bank account waits like a new recipient: it can receive a payout once the customer's waiting period has passed.
  await env.PROJECTION_DB.prepare(`INSERT INTO bank_beneficiary_projections
      (beneficiary_id, subject_reference, provider, provider_beneficiary_reference, display_name, account_hint, rail, verification_status, observed_at, available_at)
    VALUES (?1, ?2, 'bridge', ?3, ?4, ?5, 'ach', 'verified', ?6, strftime('%Y-%m-%dT%H:%M:%fZ', ?6, '+' || COALESCE(
      (SELECT new_address_delay_seconds FROM security_profiles WHERE subject_reference = ?2), ${DEFAULT_NEW_RECIPIENT_DELAY_SECONDS}) || ' seconds'))
    ON CONFLICT(subject_reference, provider, provider_beneficiary_reference) DO UPDATE SET display_name = excluded.display_name, observed_at = excluded.observed_at`)
    .bind(beneficiaryId, subject.subjectReference, account.id, account.displayName, `•••• ${account.lastFour}`, now).run();
  const saved = await env.PROJECTION_DB.prepare(`SELECT beneficiary_id, available_at FROM bank_beneficiary_projections
    WHERE subject_reference = ? AND provider = 'bridge' AND provider_beneficiary_reference = ?`)
    .bind(subject.subjectReference, account.id).first<{ beneficiary_id: string; available_at: string | null }>();
  // A new bank account is a security event, like a new recipient (saving the same account again isn't).
  if (saved?.beneficiary_id === beneficiaryId) {
    const wait = saved.available_at && saved.available_at > now ? ` It can receive from ${new Date(saved.available_at).toUTCString()}.` : "";
    await announce(env.PROJECTION_DB, subject.subjectReference,
      securityNotice("bank_account_saved", `${account.displayName} (•••• ${account.lastFour}) was saved for bank transfers.${wait}`, beneficiaryId), at);
  }
  return Response.json({ bankAccount: { name: account.displayName, lastFour: account.lastFour }, traceId: context.traceId }, { status: 201 });
});
