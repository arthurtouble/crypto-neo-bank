import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet } from "@/lib/auth/wallet";
import { errorResponse, route } from "@/lib/http/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { bridgeClient, startOnboarding } from "@/lib/providers/bridge";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const schema = z.strictObject({ fullName: z.string().trim().min(2).max(120), email: z.email().max(254) });

/**
 * Start bank-account setup with Bridge. Bridge hosts identity verification
 * and its terms; the customer finishes there.
 */
export const POST = route("money.onboarding", { invalid: "invalid_onboarding", unavailable: "onboarding_unavailable" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "bank_onboarding", subject: subject.subjectReference, limit: 5, windowSeconds: 3600 });
  const bridge = await bridgeClient(env.PROJECTION_DB);
  if (!bridge) return errorResponse(503, "feature_unavailable", context, { message: "Bank accounts aren't available yet." });
  const input = schema.parse(await request.json());
  // An Aura wallet must exist first: the USD account pays into it once verification passes.
  await requireActionWallet(subject.subjectReference);
  const now = new Date().toISOString();
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const onboarding = await startOnboarding(bridge, { subject: subject.subjectReference, ...input });
  await env.PROJECTION_DB.prepare(`INSERT INTO provider_customer_links
      (subject_reference, provider, external_customer_id, status, kyc_status, tos_status, onboarding_url, created_at, updated_at)
    VALUES (?, 'bridge', ?, 'pending', ?, ?, ?, ?, ?)
    ON CONFLICT(subject_reference, provider) DO UPDATE SET onboarding_url = excluded.onboarding_url, updated_at = excluded.updated_at
      WHERE provider_customer_links.external_customer_id = excluded.external_customer_id`)
    .bind(subject.subjectReference, onboarding.customerId, onboarding.kycStatus, onboarding.tosStatus, onboarding.kycLink, now, now).run();
  return Response.json({ verificationUrl: onboarding.kycLink, termsUrl: onboarding.tosLink, traceId: context.traceId }, { status: 201 });
});
