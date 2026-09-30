import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { errorResponse, route } from "@/lib/http/route";
import { activeBridgeCustomer, addBankAccount, bankAccountInputSchema, bridgeClient } from "@/lib/providers/bridge";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/** Save a bank account for payouts. Account details go to Bridge; Aura keeps a reference and the last four digits. */
export const POST = route("money.bank_accounts.post", { invalid: "invalid_bank_account", unavailable: "bank_account_unavailable" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "bank_account_create", subject: subject.subjectReference, limit: 5, windowSeconds: 3600 });
  const bridge = await bridgeClient(env.PROJECTION_DB);
  if (!bridge) return errorResponse(503, "feature_unavailable", context, { message: "Bank payouts aren't available yet." });
  const input = bankAccountInputSchema.parse(await request.json());
  const customerId = await activeBridgeCustomer(env.PROJECTION_DB, subject.subjectReference);
  if (!customerId) return errorResponse(409, "verification_required", context, { message: "Finish bank account setup first." });
  const account = await addBankAccount(bridge, customerId, input, crypto.randomUUID());
  const now = new Date().toISOString();
  await env.PROJECTION_DB.prepare(`INSERT INTO bank_beneficiary_projections
      (beneficiary_id, subject_reference, provider, provider_beneficiary_reference, display_name, account_hint, rail, verification_status, observed_at)
    VALUES (?, ?, 'bridge', ?, ?, ?, 'ach', 'verified', ?)
    ON CONFLICT(subject_reference, provider, provider_beneficiary_reference) DO UPDATE SET display_name = excluded.display_name, observed_at = excluded.observed_at`)
    .bind(crypto.randomUUID(), subject.subjectReference, account.id, account.displayName, `•••• ${account.lastFour}`, now).run();
  return Response.json({ bankAccount: { name: account.displayName, lastFour: account.lastFour }, traceId: context.traceId }, { status: 201 });
});
