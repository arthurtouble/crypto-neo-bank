import { env } from "cloudflare:workers";
import { requireOperationsAdmin } from "@/lib/auth/admin";
import { route } from "@/lib/http/route";

export const GET = route("ops.analytics.get", { unavailable: "analytics_unavailable" }, async (request: Request, { traceId }) => {
  await requireOperationsAdmin(request);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [customers, events, transactions, support, feedback] = await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_30d FROM subject_profiles").bind(since),
    env.PROJECTION_DB.prepare("SELECT event_name, COUNT(*) AS events, COUNT(DISTINCT subject_reference) AS customers FROM product_events WHERE occurred_at >= ? GROUP BY event_name").bind(since),
    env.PROJECTION_DB.prepare("SELECT status, COUNT(*) AS count FROM actions WHERE created_at >= ? GROUP BY status").bind(since),
    env.PROJECTION_DB.prepare("SELECT status, priority, COUNT(*) AS count FROM support_cases WHERE created_at >= ? GROUP BY status, priority").bind(since),
    env.PROJECTION_DB.prepare("SELECT sentiment, category, COUNT(*) AS count FROM customer_feedback WHERE created_at >= ? GROUP BY sentiment, category").bind(since)
  ]);
  return Response.json({ windowDays: 30, customers: customers.results[0] ?? {}, events: events.results, transactions: transactions.results, support: support.results, feedback: feedback.results, observedAt: new Date().toISOString(), traceId }, { headers: { "Cache-Control": "no-store" } });
});

