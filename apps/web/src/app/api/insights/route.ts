import { env } from "cloudflare:workers";
import { activityItem } from "@/lib/actions/activity";
import { listActions } from "@/lib/actions/store";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";
import { buildInsights, type InsightInput } from "@/lib/insights/presentation";

export const GET = route("insights.get", { unavailable: "insights_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const requestedDays = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const days = [7, 30, 90, 365].includes(requestedDays) ? requestedDays : 30;
  const actions = await listActions(env.PROJECTION_DB, subject.subjectReference, 500);
  const inputs: InsightInput[] = actions.map(activityItem).map((item) => ({ type: item.type, status: item.status,
    createdAt: item.createdAt, amount: item.amount, asset: item.asset, estimatedUsd: item.estimatedUsd }));
  return Response.json({ ...buildInsights(inputs, new Date(), days), observedAt: new Date().toISOString(),
    authority: "Derived from Aura actions; providers and blockchains remain authoritative", traceId });
});
