import { env } from "cloudflare:workers";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";

type CountRow = { status: string; count: number };
type IssueRow = { issue_id: string; issue_type: string; severity: string; source_name: string; summary: string; status: string; opened_at: string };

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireOperationsAdmin(request);
    const [intents, receipts, issues, freshness] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("SELECT status, COUNT(*) AS count FROM transaction_intents GROUP BY status"),
      env.PROJECTION_DB.prepare("SELECT processing_status AS status, COUNT(*) AS count FROM webhook_receipts GROUP BY processing_status"),
      env.PROJECTION_DB.prepare("SELECT issue_id, issue_type, severity, source_name, summary, status, opened_at FROM operational_issues WHERE status != 'resolved' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, opened_at DESC LIMIT 100"),
      env.PROJECTION_DB.prepare("SELECT COUNT(*) AS count, MAX(observed_at) AS latest FROM position_projections")
    ]);
    return Response.json({
      intents: intents.results as unknown as CountRow[],
      webhooks: receipts.results as unknown as CountRow[],
      issues: issues.results as unknown as IssueRow[],
      projections: (freshness.results[0] ?? { count: 0, latest: null }) as Record<string, unknown>,
      observedAt: new Date().toISOString(),
      authority: "Disposable operational projections; never an asset ledger"
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", message: error.message, traceId }, { status: 403 });
    console.error(JSON.stringify({ level: "error", event: "ops.summary.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "ops_unavailable", traceId }, { status: 503 });
  }
}
