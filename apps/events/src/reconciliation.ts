import { STUCK_SETTLING_MS, STUCK_SUBMITTED_MS } from "@aurel/provider-projections";

type ActionRow = { action_id: string; subject_reference: string; status: string };
type WebhookRow = { event_id: string; subject_reference: string | null; provider: string };

function issueStatement(
  db: D1Database,
  input: { subjectReference: string | null; type: string; severity: string; sourceName: string; sourceReference: string; summary: string; now: string }
) {
  return db.prepare(`INSERT INTO operational_issues
    (issue_id, subject_reference, issue_type, severity, source_name, source_reference, summary, status, opened_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, 'open', ?
    WHERE NOT EXISTS (
      SELECT 1 FROM operational_issues WHERE issue_type = ? AND source_reference = ? AND status != 'resolved'
    )`).bind(
      crypto.randomUUID(), input.subjectReference, input.type, input.severity, input.sourceName,
      input.sourceReference, input.summary, input.now, input.type, input.sourceReference
    );
}

export async function recordDeadLetter(db: D1Database, message: Message<{ event?: { id?: string; provider?: string; subjectReference?: string } }>): Promise<void> {
  const event = message.body?.event;
  const eventId = event?.id ?? `queue:${message.id}`;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE webhook_receipts SET processing_status = 'failed', last_error = ?, processed_at = ? WHERE event_id = ?")
      .bind("Provider event exhausted Queue retries and entered the dead-letter queue.", now, eventId),
    issueStatement(db, {
      subjectReference: event?.subjectReference ?? null,
      type: "webhook_dead_letter",
      severity: "critical",
      sourceName: event?.provider ?? "provider_queue",
      sourceReference: eventId,
      summary: "A provider event exhausted Queue retries and requires reconciliation.",
      now
    })
  ]);
}

export async function runScheduledReconciliation(db: D1Database, scheduledTime = Date.now()) {
  const now = new Date(scheduledTime).toISOString();
  const staleBefore = new Date(scheduledTime - STUCK_SUBMITTED_MS).toISOString();
  const settlingBefore = new Date(scheduledTime - STUCK_SETTLING_MS).toISOString();
  const webhookStaleBefore = new Date(scheduledTime - 10 * 60_000).toISOString();
  const [staleActions, failedWebhooks, stuckWebhooks] = await db.batch([
    db.prepare(`SELECT action_id, subject_reference, status FROM actions
      WHERE (status = 'submitted' AND submitted_at < ?) OR (status = 'settling' AND submitted_at < ?) LIMIT 250`).bind(staleBefore, settlingBefore),
    db.prepare("SELECT event_id, subject_reference, provider FROM webhook_receipts WHERE processing_status = 'failed' LIMIT 250"),
    db.prepare("SELECT event_id, subject_reference, provider FROM webhook_receipts WHERE processing_status IN ('received', 'enqueued') AND received_at < ? LIMIT 250").bind(webhookStaleBefore)
  ]);

  const statements: D1PreparedStatement[] = [];
  for (const item of staleActions.results as unknown as ActionRow[]) statements.push(issueStatement(db, {
    subjectReference: item.subject_reference, type: "stale_action", severity: "high", sourceName: "source_chain",
    sourceReference: item.action_id, summary: item.status === "settling"
      ? "A cross-chain action has not been delivered after 2 hours." : "A submitted action has no settled receipt after 15 minutes.", now
  }));
  for (const item of failedWebhooks.results as unknown as WebhookRow[]) statements.push(issueStatement(db, {
    subjectReference: item.subject_reference, type: "webhook_failed", severity: "high", sourceName: item.provider,
    sourceReference: item.event_id, summary: "A provider event exhausted processing attempts.", now
  }));
  for (const item of stuckWebhooks.results as unknown as WebhookRow[]) statements.push(issueStatement(db, {
    subjectReference: item.subject_reference, type: "webhook_stalled", severity: "high", sourceName: item.provider,
    sourceReference: item.event_id, summary: "A provider event has not completed processing within 10 minutes.", now
  }));

  const details = {
    staleActions: staleActions.results.length,
    failedWebhooks: failedWebhooks.results.length,
    stalledWebhooks: stuckWebhooks.results.length,
    issueCandidates: statements.length
  };
  statements.push(
    db.prepare("DELETE FROM rate_limit_windows WHERE reset_at < ?").bind(scheduledTime - 86_400_000),
    db.prepare(`INSERT INTO operational_checks (check_key, status, details_json, checked_at)
      VALUES ('scheduled_reconciliation', 'ok', ?, ?)
      ON CONFLICT(check_key) DO UPDATE SET status = excluded.status, details_json = excluded.details_json, checked_at = excluded.checked_at`)
      .bind(JSON.stringify(details), now)
  );
  await db.batch(statements);
  return details;
}

type DependencyProbe = { key: string; label: string; url: string; init?: RequestInit; validate: (response: Response) => Promise<boolean> };

const probes: DependencyProbe[] = [
  {
    key: "dependency_base", label: "Base mainnet", url: "https://base-rpc.publicnode.com",
    init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) },
    validate: async (response) => response.ok && Boolean((await response.json() as { result?: string }).result)
  },
  {
    key: "dependency_lifi", label: "LI.FI routing", url: "https://li.quest/v1/chains",
    validate: async (response) => response.ok && Array.isArray((await response.json() as { chains?: unknown[] }).chains)
  },
  {
    key: "dependency_aave", label: "Aave data service", url: "https://mcp.aave.com/",
    init: { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Aurel-Status/1.0" }, body: JSON.stringify({ jsonrpc: "2.0", id: "status", method: "tools/list", params: {} }) },
    validate: async (response) => response.ok && Boolean((await response.json() as { result?: unknown }).result)
  }
];

export async function checkDependencies(db: D1Database, checkedAt = new Date()): Promise<Record<string, string>> {
  const now = checkedAt.toISOString();
  const results = await Promise.all(probes.map(async (probe) => {
    const started = Date.now();
    let status = "operational";
    let detail = "Available";
    try {
      const response = await fetch(probe.url, { ...probe.init, signal: AbortSignal.timeout(8_000) });
      if (!await probe.validate(response)) { status = "degraded"; detail = `Unexpected response (${response.status})`; }
    } catch (error) {
      status = "unavailable";
      detail = error instanceof Error && error.name === "TimeoutError" ? "Timed out" : "Probe failed";
    }
    return { probe, status, detail, latencyMs: Date.now() - started };
  }));

  const statements: D1PreparedStatement[] = [];
  for (const result of results) {
    statements.push(db.prepare(`INSERT INTO operational_checks (check_key, status, details_json, checked_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(check_key) DO UPDATE SET status = excluded.status, details_json = excluded.details_json, checked_at = excluded.checked_at`)
      .bind(result.probe.key, result.status, JSON.stringify({ label: result.probe.label, detail: result.detail, latencyMs: result.latencyMs }), now));
    if (result.status !== "operational") statements.push(issueStatement(db, {
      subjectReference: null, type: "dependency_unavailable", severity: "high", sourceName: result.probe.label,
      sourceReference: result.probe.key, summary: `${result.probe.label} is ${result.status}: ${result.detail}.`, now
    }));
    else statements.push(db.prepare("UPDATE operational_issues SET status = 'resolved', resolved_at = ? WHERE issue_type = 'dependency_unavailable' AND source_reference = ? AND status != 'resolved'").bind(now, result.probe.key));
  }
  await db.batch(statements);
  return Object.fromEntries(results.map((result) => [result.probe.key, result.status]));
}
