import { env } from "cloudflare:workers";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireOperationsAdmin(request);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [customers, events, transactions, support, feedback, cohorts] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_30d FROM subject_profiles").bind(since),
      env.PROJECTION_DB.prepare("SELECT event_name, COUNT(*) AS events, COUNT(DISTINCT subject_reference) AS customers FROM product_events WHERE occurred_at >= ? GROUP BY event_name").bind(since),
      env.PROJECTION_DB.prepare("SELECT status, COUNT(*) AS count FROM transaction_intents WHERE created_at >= ? GROUP BY status").bind(since),
      env.PROJECTION_DB.prepare("SELECT status, priority, COUNT(*) AS count FROM support_cases WHERE created_at >= ? GROUP BY status, priority").bind(since),
      env.PROJECTION_DB.prepare("SELECT sentiment, category, COUNT(*) AS count FROM customer_feedback WHERE created_at >= ? GROUP BY sentiment, category").bind(since),
      env.PROJECTION_DB.prepare("SELECT cohort, status, COUNT(*) AS count FROM beta_access GROUP BY cohort, status")
    ]);
    return Response.json({ windowDays: 30, customers: customers.results[0] ?? {}, events: events.results, transactions: transactions.results, support: support.results, feedback: feedback.results, cohorts: cohorts.results, observedAt: new Date().toISOString(), traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", traceId }, { status: 403 });
    return Response.json({ error: "analytics_unavailable", traceId }, { status: 503 });
  }
}

