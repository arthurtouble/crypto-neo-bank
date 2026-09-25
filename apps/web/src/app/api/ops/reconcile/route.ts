import { env } from "cloudflare:workers";
import { requireOperationsAdmin } from "@/lib/auth/admin";
import { route } from "@/lib/http/route";

const STALE_SUBMITTED_MS = 15 * 60_000;
const STALE_SETTLING_MS = 2 * 60 * 60_000;

function openIssue(db: D1Database, type: string, severity: string, source: string, reference: string, subject: string | null, summary: string, now: string) {
  return db.prepare(`INSERT INTO operational_issues (issue_id, subject_reference, issue_type, severity, source_name, source_reference, summary, status, opened_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, 'open', ?
    WHERE NOT EXISTS (SELECT 1 FROM operational_issues WHERE issue_type = ? AND source_reference = ? AND status != 'resolved')`)
    .bind(crypto.randomUUID(), subject, type, severity, source, reference, summary, now, type, reference);
}

/** Open issues for actions that have not settled in time and for provider events that failed. */
export const POST = route("ops.reconcile.post", { unavailable: "reconciliation_unavailable" }, async (request, { traceId }) => {
  const admin = await requireOperationsAdmin(request);
  const now = Date.now();
  const at = new Date(now).toISOString();
  const [stale, failed] = await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare(`SELECT action_id, subject_reference, status FROM actions
      WHERE (status = 'submitted' AND submitted_at < ?) OR (status = 'settling' AND submitted_at < ?) LIMIT 100`)
      .bind(new Date(now - STALE_SUBMITTED_MS).toISOString(), new Date(now - STALE_SETTLING_MS).toISOString()),
    env.PROJECTION_DB.prepare("SELECT event_id, subject_reference, provider FROM webhook_receipts WHERE processing_status = 'failed' LIMIT 100")
  ]);
  const statements = [
    ...(stale.results as Array<{ action_id: string; subject_reference: string; status: string }>).map((item) => openIssue(env.PROJECTION_DB,
      "stale_action", "high", "source_chain", item.action_id, item.subject_reference,
      item.status === "settling" ? "A cross-chain action has not been delivered after 2 hours." : "A submitted action has no settled receipt after 15 minutes.", at)),
    ...(failed.results as Array<{ event_id: string; subject_reference: string | null; provider: string }>).map((item) => openIssue(env.PROJECTION_DB,
      "webhook_failed", "high", item.provider, item.event_id, item.subject_reference, "A provider event exhausted processing attempts.", at))
  ];
  if (statements.length) await env.PROJECTION_DB.batch(statements);
  await env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
    VALUES (?, NULL, 'operator', ?, 'run_reconciliation', 'projection', NULL, ?, ?)`)
    .bind(crypto.randomUUID(), admin.subjectReference, JSON.stringify({ staleActions: stale.results.length, failedWebhooks: failed.results.length }), at).run();
  return Response.json({ checked: stale.results.length + failed.results.length, openedCandidates: statements.length, completedAt: at, traceId });
});
