import { env } from "cloudflare:workers";
import { requireOperator } from "@/lib/auth/access";
import { STUCK_SETTLING_MS, STUCK_SUBMITTED_MS } from "@/lib/actions/store";
import { route } from "@/lib/http/route";
import { readStats } from "@/lib/ops/stats";

/** Customers, activity, volume by kind, and the new-customer funnel, over 7, 30, or 90 days. */
export const GET = route("ops.stats.get", { unavailable: "stats_unavailable" }, async (request, { traceId }) => {
  await requireOperator(request);
  const requested = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const days = [7, 30, 90].includes(requested) ? requested : 30;
  const now = new Date();
  const stats = await readStats(env.PROJECTION_DB, days, now, {
    submitted: new Date(now.getTime() - STUCK_SUBMITTED_MS).toISOString(), settling: new Date(now.getTime() - STUCK_SETTLING_MS).toISOString() });
  return Response.json({ ...stats, traceId }, { headers: { "Cache-Control": "no-store" } });
});
