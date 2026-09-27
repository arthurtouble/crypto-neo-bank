import { env } from "cloudflare:workers";
import { readHistory } from "@/lib/activity/history";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/** The customer's Transactions: their Aura actions, money that arrived without one, and Aave history, for their own account only. */
export const GET = route("activity.get", { unavailable: "activity_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "activity_read", subject: subject.subjectReference, limit: 150, windowSeconds: 3600 });
  const wallet = await requireActionWallet(subject.subjectReference);
  return Response.json({ ...await readHistory(env.PROJECTION_DB, subject.subjectReference, wallet), traceId });
});
