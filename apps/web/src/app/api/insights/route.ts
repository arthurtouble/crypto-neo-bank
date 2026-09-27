import { env } from "cloudflare:workers";
import { readPeriod } from "@/lib/activity/history";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { buildInsights } from "@/lib/insights/presentation";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const GET = route("insights.get", { unavailable: "insights_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "insights", subject: subject.subjectReference, limit: 60, windowSeconds: 3600 });
  const requestedDays = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const days = [7, 30, 90, 365].includes(requestedDays) ? requestedDays : 30;
  const now = new Date();
  const wallet = await requireActionWallet(subject.subjectReference);
  const { entries, complete } = await readPeriod(env.PROJECTION_DB, subject.subjectReference, wallet, new Date(now.getTime() - days * 86_400_000), now);
  // Without every incoming transfer, money in is unknown, not zero.
  return Response.json({ ...buildInsights(entries, now, days), incomingComplete: complete, observedAt: now.toISOString(), traceId });
});
