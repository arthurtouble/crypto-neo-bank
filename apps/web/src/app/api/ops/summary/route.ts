import { env } from "cloudflare:workers";
import { requireOperationsAdmin } from "@/lib/auth/admin";
import { route } from "@/lib/http/route";

type CountRow = { status: string; count: number };
type IssueRow = { issue_id: string; issue_type: string; severity: string; source_name: string; summary: string; status: string; opened_at: string };
type CheckRow = { check_key: string; status: string; details_json: string; checked_at: string };

export const GET = route("ops.summary.get", { unavailable: "ops_unavailable" }, async (request: Request) => {
  await requireOperationsAdmin(request);
  const [intents, receipts, issues, funnel, reliability, checks] = await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare("SELECT status, COUNT(*) AS count FROM actions GROUP BY status"),
    env.PROJECTION_DB.prepare("SELECT processing_status AS status, COUNT(*) AS count FROM webhook_receipts GROUP BY processing_status"),
    env.PROJECTION_DB.prepare("SELECT issue_id, issue_type, severity, source_name, summary, status, opened_at FROM operational_issues WHERE status != 'resolved' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, opened_at DESC LIMIT 100"),
    env.PROJECTION_DB.prepare("SELECT event_name AS status, COUNT(DISTINCT subject_reference) AS count FROM product_events WHERE occurred_at >= ? GROUP BY event_name").bind(new Date(Date.now() - 7 * 86_400_000).toISOString()),
    env.PROJECTION_DB.prepare(`SELECT
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('submitted', 'settling') AND submitted_at < ? THEN 1 ELSE 0 END) AS stale
      FROM actions`).bind(new Date(Date.now() - 15 * 60_000).toISOString()),
    env.PROJECTION_DB.prepare("SELECT check_key, status, details_json, checked_at FROM operational_checks ORDER BY checked_at DESC")
  ]);
  return Response.json({
    intents: intents.results as unknown as CountRow[],
    webhooks: receipts.results as unknown as CountRow[],
    issues: issues.results as unknown as IssueRow[],
    funnel: funnel.results as unknown as CountRow[],
    reliability: (reliability.results[0] ?? { confirmed: 0, failed: 0, stale: 0 }) as Record<string, unknown>,
    checks: (checks.results as unknown as CheckRow[]).map((check) => ({ ...check, details: JSON.parse(check.details_json) })),
    observedAt: new Date().toISOString(),
    authority: "Operational evidence and rebuildable projections; never an asset ledger"
  }, { headers: { "Cache-Control": "no-store" } });
});
