export async function ensureSubjectProfile(database: D1Database, subjectReference: string, now = new Date()): Promise<void> {
  const timestamp = now.toISOString();
  await database.batch([
    database.prepare(`INSERT INTO subject_profiles
      (subject_reference, privy_user_reference, onboarding_state, created_at, updated_at)
      VALUES (?, ?, 'wallet_ready', ?, ?)
      ON CONFLICT(subject_reference) DO UPDATE SET updated_at = excluded.updated_at`)
      .bind(subjectReference, subjectReference, timestamp, timestamp),
    database.prepare(`INSERT INTO security_profiles
      (subject_reference, updated_at) VALUES (?, ?)
      ON CONFLICT(subject_reference) DO NOTHING`).bind(subjectReference, timestamp),
    database.prepare(`INSERT INTO onboarding_progress
      (subject_reference, first_seen_at, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(subject_reference) DO UPDATE SET updated_at = excluded.updated_at`)
      .bind(subjectReference, timestamp, timestamp)
  ]);
}
