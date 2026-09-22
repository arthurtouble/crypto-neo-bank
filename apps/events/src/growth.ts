const RETENTION_RULE_VERSION = "retained-30d-v1";
const FIRST_VALUE_RULE_VERSION = "confirmed-intent-v1";

type LinkedSubject = {
  application_id: string;
  subject_reference: string;
  linked_at: string;
};

type TimedEvent = { occurred_at: string };

function growthEvent(
  db: D1Database,
  input: { applicationId: string; subjectReference: string; name: string; surface: string; properties: Record<string, string>; occurredAt: string }
) {
  return db.prepare(`INSERT INTO growth_events
    (event_id, application_id, subject_reference, anonymous_session_id, event_name, surface, campaign_id, content_id, properties_json, occurred_at)
    SELECT ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM growth_events WHERE subject_reference = ? AND event_name = ?
    )`).bind(
      crypto.randomUUID(), input.applicationId, input.subjectReference, input.name, input.surface,
      JSON.stringify(input.properties), input.occurredAt, input.subjectReference, input.name
    );
}

export async function materializeGrowthMilestones(db: D1Database, scheduledTime = Date.now()) {
  const now = new Date(scheduledTime);
  const linked = await db.prepare(`SELECT gsl.application_id, gsl.subject_reference, gsl.linked_at
    FROM growth_subject_links gsl
    JOIN beta_access ba ON ba.subject_reference = gsl.subject_reference
    WHERE ba.status = 'active' LIMIT 500`).all<LinkedSubject>();

  let createdCandidates = 0;
  let retainedCandidates = 0;
  for (const subject of linked.results) {
    const [profile, secured, confirmed, laterActivity, firstValue] = await db.batch([
      db.prepare("SELECT created_at FROM subject_profiles WHERE subject_reference = ? AND onboarding_state = 'wallet_ready'").bind(subject.subject_reference),
      db.prepare("SELECT occurred_at FROM product_events WHERE subject_reference = ? AND event_name = 'security_updated' ORDER BY occurred_at LIMIT 1").bind(subject.subject_reference),
      db.prepare("SELECT updated_at AS occurred_at FROM transaction_intents WHERE subject_reference = ? AND status = 'confirmed' ORDER BY updated_at LIMIT 1").bind(subject.subject_reference),
      db.prepare("SELECT occurred_at FROM product_events WHERE subject_reference = ? AND event_name IN ('security_updated','transaction_submitted','support_opened') AND occurred_at >= ? AND occurred_at <= ? ORDER BY occurred_at DESC LIMIT 1")
        .bind(subject.subject_reference, new Date(Date.parse(subject.linked_at) + 21 * 86_400_000).toISOString(), new Date(Date.parse(subject.linked_at) + 37 * 86_400_000).toISOString()),
      db.prepare("SELECT occurred_at FROM growth_events WHERE subject_reference = ? AND event_name = 'first_value_completed' ORDER BY occurred_at LIMIT 1").bind(subject.subject_reference)
    ]);
    const statements: D1PreparedStatement[] = [
      growthEvent(db, { applicationId: subject.application_id, subjectReference: subject.subject_reference, name: "onboarding_started", surface: "server:subject-linked", properties: { definitionVersion: "subject-link-v1" }, occurredAt: subject.linked_at })
    ];
    const profileAt = (profile.results[0] as TimedEvent | undefined)?.occurred_at ?? (profile.results[0] as { created_at?: string } | undefined)?.created_at;
    if (profileAt) statements.push(growthEvent(db, { applicationId: subject.application_id, subjectReference: subject.subject_reference, name: "wallet_ready", surface: "server:profile", properties: { definitionVersion: "profile-wallet-ready-v1" }, occurredAt: profileAt }));
    const securedAt = (secured.results[0] as TimedEvent | undefined)?.occurred_at;
    if (securedAt) statements.push(growthEvent(db, { applicationId: subject.application_id, subjectReference: subject.subject_reference, name: "account_secured", surface: "server:security-policy", properties: { definitionVersion: "security-policy-updated-v1" }, occurredAt: securedAt }));
    const confirmedAt = (confirmed.results[0] as TimedEvent | undefined)?.occurred_at;
    if (confirmedAt) statements.push(growthEvent(db, { applicationId: subject.application_id, subjectReference: subject.subject_reference, name: "first_value_completed", surface: "server:confirmed-intent", properties: { definitionVersion: FIRST_VALUE_RULE_VERSION }, occurredAt: confirmedAt }));
    await db.batch(statements);
    createdCandidates += statements.length;

    const activationAt = (firstValue.results[0] as TimedEvent | undefined)?.occurred_at ?? confirmedAt;
    if (!activationAt) continue;
    const ageDays = (now.getTime() - Date.parse(activationAt)) / 86_400_000;
    if (ageDays < 30) continue;
    const returnedAt = (laterActivity.results[0] as TimedEvent | undefined)?.occurred_at;
    const retained = Boolean(returnedAt);
    await db.batch([
      db.prepare(`INSERT INTO growth_retention_runs (run_id, rule_version, subject_reference, activation_at, retained_at, result, evaluated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(rule_version, subject_reference) DO UPDATE SET retained_at = excluded.retained_at, result = excluded.result, evaluated_at = excluded.evaluated_at`)
        .bind(crypto.randomUUID(), RETENTION_RULE_VERSION, subject.subject_reference, activationAt, returnedAt ?? null, retained ? "retained" : "not_retained", now.toISOString()),
      ...(retained ? [growthEvent(db, { applicationId: subject.application_id, subjectReference: subject.subject_reference, name: "retained_30d", surface: "server:retention-job", properties: { definitionVersion: RETENTION_RULE_VERSION }, occurredAt: now.toISOString() })] : [])
    ]);
    retainedCandidates += retained ? 1 : 0;
  }
  return { linkedSubjects: linked.results.length, milestoneCandidates: createdCandidates, retainedCandidates, retentionRuleVersion: RETENTION_RULE_VERSION };
}
