type IntentRow = { intent_id: string; subject_reference: string };
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
  const staleBefore = new Date(scheduledTime - 15 * 60_000).toISOString();
  const webhookStaleBefore = new Date(scheduledTime - 10 * 60_000).toISOString();
  const [expired, staleSubmitted, failedWebhooks, stuckWebhooks] = await db.batch([
    db.prepare("SELECT intent_id, subject_reference FROM transaction_intents WHERE status = 'reviewed' AND expires_at < ? LIMIT 250").bind(now),
    db.prepare("SELECT intent_id, subject_reference FROM transaction_intents WHERE status = 'submitted' AND updated_at < ? LIMIT 250").bind(staleBefore),
    db.prepare("SELECT event_id, subject_reference, provider FROM webhook_receipts WHERE processing_status = 'failed' LIMIT 250"),
    db.prepare("SELECT event_id, subject_reference, provider FROM webhook_receipts WHERE processing_status IN ('received', 'enqueued') AND received_at < ? LIMIT 250").bind(webhookStaleBefore)
  ]);

  const statements: D1PreparedStatement[] = [];
  for (const item of expired.results as unknown as IntentRow[]) statements.push(issueStatement(db, {
    subjectReference: item.subject_reference, type: "expired_intent", severity: "warning", sourceName: "transaction_policy",
    sourceReference: item.intent_id, summary: "A reviewed transaction intent expired without submission.", now
  }));
  for (const item of staleSubmitted.results as unknown as IntentRow[]) statements.push(issueStatement(db, {
    subjectReference: item.subject_reference, type: "stale_transaction", severity: "high", sourceName: "source_chain",
    sourceReference: item.intent_id, summary: "A submitted transaction has no observed source receipt after 15 minutes.", now
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
    expiredIntents: expired.results.length,
    staleTransactions: staleSubmitted.results.length,
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
