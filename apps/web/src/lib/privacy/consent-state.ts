/** A withdrawal wins a timestamp tie; delivery providers must check this before sending. */
export async function hasConsent(database: D1Database, subjectReference: string, purpose: "service_updates" | "marketing") {
  const latest = await database.prepare("SELECT action FROM consent_events WHERE subject_reference = ? AND purpose = ? ORDER BY occurred_at DESC, (action = 'withdrawn') DESC LIMIT 1")
    .bind(subjectReference, purpose).first<{ action: string }>();
  return latest?.action === "granted";
}
