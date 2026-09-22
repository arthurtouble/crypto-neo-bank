export async function writeAuditEvent(database: D1Database, input: {
  subjectReference?: string;
  actorType: "customer" | "administrator" | "operator" | "system";
  actorReference: string;
  action: string;
  targetType: string;
  targetReference?: string;
  evidence?: Record<string, unknown>;
  occurredAt?: string;
}): Promise<void> {
  await database.prepare(`INSERT INTO audit_events
    (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), input.subjectReference ?? null, input.actorType, input.actorReference, input.action, input.targetType, input.targetReference ?? null, JSON.stringify(input.evidence ?? {}), input.occurredAt ?? new Date().toISOString()).run();
}
