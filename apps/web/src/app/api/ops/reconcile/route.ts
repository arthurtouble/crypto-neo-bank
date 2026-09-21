import { env } from "cloudflare:workers";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const admin = await requireOperationsAdmin(request);
    const now = new Date().toISOString();
    const expired = await env.PROJECTION_DB.prepare("SELECT intent_id, subject_reference FROM transaction_intents WHERE status = 'reviewed' AND expires_at < ? LIMIT 100").bind(now).all<{ intent_id: string; subject_reference: string }>();
    const failed = await env.PROJECTION_DB.prepare("SELECT event_id, subject_reference, provider FROM webhook_receipts WHERE processing_status = 'failed' LIMIT 100").all<{ event_id: string; subject_reference: string | null; provider: string }>();
    const statements: D1PreparedStatement[] = [];
    for (const item of expired.results) statements.push(env.PROJECTION_DB.prepare(`INSERT INTO operational_issues (issue_id, subject_reference, issue_type, severity, source_name, source_reference, summary, status, opened_at)
      SELECT ?, ?, 'expired_intent', 'warning', 'transaction_policy', ?, 'A reviewed transaction intent expired without submission.', 'open', ?
      WHERE NOT EXISTS (SELECT 1 FROM operational_issues WHERE issue_type = 'expired_intent' AND source_reference = ? AND status != 'resolved')`).bind(crypto.randomUUID(), item.subject_reference, item.intent_id, now, item.intent_id));
    for (const item of failed.results) statements.push(env.PROJECTION_DB.prepare(`INSERT INTO operational_issues (issue_id, subject_reference, issue_type, severity, source_name, source_reference, summary, status, opened_at)
      SELECT ?, ?, 'webhook_failed', 'high', ?, ?, 'A provider event exhausted processing attempts.', 'open', ?
      WHERE NOT EXISTS (SELECT 1 FROM operational_issues WHERE issue_type = 'webhook_failed' AND source_reference = ? AND status != 'resolved')`).bind(crypto.randomUUID(), item.subject_reference, item.provider, item.event_id, now, item.event_id));
    if (statements.length) await env.PROJECTION_DB.batch(statements);
    await env.PROJECTION_DB.prepare("INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at) VALUES (?, NULL, 'operator', ?, 'run_reconciliation', 'projection', NULL, ?, ?)").bind(crypto.randomUUID(), admin.subjectReference, JSON.stringify({ expiredIntents: expired.results.length, failedWebhooks: failed.results.length }), now).run();
    return Response.json({ checked: expired.results.length + failed.results.length, openedCandidates: statements.length, completedAt: now, traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", message: error.message, traceId }, { status: 403 });
    console.error(JSON.stringify({ level: "error", event: "ops.reconcile.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "reconciliation_unavailable", traceId }, { status: 503 });
  }
}
