import { env } from "cloudflare:workers";
import { z } from "zod";
import { readHistory } from "@/lib/activity/history";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const beforeSchema = z.iso.datetime().optional();

/**
 * The customer's Transactions: their Aura actions, money that arrived without one, and Aave history, for their own account only.
 * `?before=<ISO time>` reads an older page: what happened at or before that time.
 */
export const GET = route("activity.get", { invalid: "invalid_before", unavailable: "activity_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "activity_read", subject: subject.subjectReference, limit: 150, windowSeconds: 3600 });
  const before = beforeSchema.parse(new URL(request.url).searchParams.get("before") ?? undefined);
  const wallet = await requireActionWallet(subject.subjectReference);
  return Response.json({ ...await readHistory(env.PROJECTION_DB, subject.subjectReference, wallet, new Date(), {}, before ? new Date(before) : undefined), traceId });
});
