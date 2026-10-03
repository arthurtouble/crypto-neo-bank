/**
 * Scheduled cleanup of short-lived records (docs/operations/data-retention-schedule.md).
 *
 * Only the tables listed here are ever deleted from, and only rows that no read
 * path, retry guarantee, or dedupe check still needs. Financial projections,
 * actions and their events, consent, audit, and security records are never
 * touched (actions and action_events refuse deletes in the schema anyway).
 *
 * Each run deletes at most `limit` rows per table, so a run stays short; a
 * backlog clears over later runs. The web cron runs it once an hour
 * (`purgeDue`).
 */
const DAY_MS = 86_400_000;

/**
 * Money received is announced only if it arrived in this window (lib/notifications/incoming.ts). It must stay
 * shorter than the notification period below: a received notice is deleted only once its transfer is too old to be
 * announced again, so purging never makes Aura announce the same money twice.
 */
export const RECEIVED_NOTICE_WINDOW_DAYS = 90;

/** Days each purged record is kept past the point it stops being needed. */
export const retentionDays = {
  product_events: 180,
  notifications: 180,
  step_up_challenges: 1,
  market_signature_requests: 1,
  rate_limit_windows: 1,
  route_quotes: 1,
  command_idempotency: 30,
  webhook_receipts: 730
} as const;

export type PurgedTable = keyof typeof retentionDays;
export type PurgeCounts = Record<PurgedTable, number>;

type Rule = { key: string; where: string; cutoff: (now: Date, days: number) => string | number };
const isoBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();

const rules: Record<PurgedTable, Rule> = {
  // Analytics events, by when they happened. The operations app reads 90 days at most.
  product_events: { key: "event_id", where: "occurred_at < ?1", cutoff: isoBefore },
  // Notices, once neither channel is still pending. Their dedupe keys only matter while the event can be seen again.
  notifications: { key: "notification_id", where: "created_at < ?1 AND email_status != 'pending' AND push_status != 'pending'", cutoff: isoBefore },
  // Passkey confirmations last 5 minutes; the change itself is in audit_events.
  step_up_challenges: { key: "challenge_id", where: "expires_at < ?1", cutoff: isoBefore },
  // Passkey requests for a venue last 5 minutes; what they did is in market_operations.
  market_signature_requests: { key: "request_id", where: "expires_at < ?1", cutoff: isoBefore },
  // Counters, a day after their window reset (milliseconds since the epoch).
  rate_limit_windows: { key: "bucket_key", where: "reset_at < ?1", cutoff: (now, days) => now.getTime() - days * DAY_MS },
  // Expired quotes no action used. A used quote follows its action and is never deleted.
  route_quotes: { key: "quote_id", where: `action_id IS NULL AND expires_at < ?1
    AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.route_quote_id = route_quotes.quote_id)`, cutoff: isoBefore },
  // An expired claim can already be taken again, so deleting it changes nothing for a retry.
  command_idempotency: { key: "idempotency_key", where: "expires_at < ?1", cutoff: isoBefore },
  // Processed provider events only; received, enqueued, and failed ones stay for reconciliation.
  webhook_receipts: { key: "event_id", where: "processing_status = 'processed' AND received_at < ?1", cutoff: isoBefore }
};

export const PURGE_LIMIT = 500;

/** The web cron runs every 2 minutes; cleanup runs on the one at the top of each hour. */
export const purgeDue = (now: Date) => now.getUTCMinutes() === 0;

/** Delete up to `limit` expired rows from each table in the schedule. Returns how many each lost. */
export async function purgeExpired(db: D1Database, now = new Date(), limit = PURGE_LIMIT): Promise<PurgeCounts> {
  const tables = Object.keys(rules) as PurgedTable[];
  const results = await db.batch(tables.map((table) => {
    const { key, where, cutoff } = rules[table];
    return db.prepare(`DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE ${where} LIMIT ${Math.max(1, Math.floor(limit))})`)
      .bind(cutoff(now, retentionDays[table]));
  }));
  return Object.fromEntries(tables.map((table, index) => [table, results[index].meta.changes ?? 0])) as PurgeCounts;
}
