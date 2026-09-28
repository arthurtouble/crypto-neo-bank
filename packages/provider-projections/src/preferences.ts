import { z } from "zod";
import type { ProjectionDatabase } from "./database";

/**
 * Customer-owned notification choices for transaction notices by email and
 * push (apps/web/src/lib/notifications/deliver.ts). Security notices are
 * never optional.
 * Marketing email is consent, not a preference: see consent_events.
 */
export const preferencesSchema = z.object({
  notifications: z.object({
    transactionEmail: z.boolean()
  }).strict()
}).strict();
export type Preferences = z.infer<typeof preferencesSchema>;

export const preferencesUpdateSchema = z.object({
  notifications: preferencesSchema.shape.notifications.partial().strict()
}).strict();
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>;

export const defaultPreferences: Preferences = {
  notifications: { transactionEmail: true }
};

export async function readPreferences(db: ProjectionDatabase, subjectReference: string): Promise<Preferences & { updatedAt: string | null }> {
  const row = await db.prepare("SELECT value_json, updated_at FROM user_preferences WHERE subject_reference = ?")
    .bind(subjectReference).first<{ value_json: string; updated_at: string }>();
  if (!row) return { ...defaultPreferences, updatedAt: null };
  let stored: unknown = null;
  try { stored = JSON.parse(row.value_json); } catch { /* fall back to defaults below */ }
  const parsed = preferencesSchema.safeParse(stored);
  return { ...(parsed.success ? parsed.data : defaultPreferences), updatedAt: row.updated_at };
}

/** Merge a partial update over the current (or default) preferences and store the full document. */
export async function updatePreferences(db: ProjectionDatabase, subjectReference: string, update: PreferencesUpdate, now = new Date().toISOString()): Promise<Preferences> {
  const current = await readPreferences(db, subjectReference);
  const next = preferencesSchema.parse({ notifications: { ...current.notifications, ...update.notifications } });
  await db.prepare(`INSERT INTO user_preferences (subject_reference, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(subject_reference) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .bind(subjectReference, JSON.stringify(next), now).run();
  return next;
}
