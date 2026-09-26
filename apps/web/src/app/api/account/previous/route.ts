import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { findLegacySmartWallet, requireActionWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/** The smart wallet an earlier version of Aura used as the account, and the account funds move to. */
export const GET = route("account.previous", { unavailable: "account_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "account_previous", subject: subject.subjectReference, limit: 60, windowSeconds: 3600 });
  const [previous, account] = await Promise.all([findLegacySmartWallet(subject.subjectReference), requireActionWallet(subject.subjectReference)]);
  return Response.json({ previous, account, traceId });
});
