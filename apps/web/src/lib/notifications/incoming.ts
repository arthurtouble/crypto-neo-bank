import { readIncoming } from "@/lib/activity/incoming";
import { listActionHashes } from "@/lib/actions/store";
import { notify, receivedNotice } from "./store";

/**
 * Notices for money received. An account is watched once the customer uses
 * Aura, and for 30 days after they were last active. Only money received
 * after the watch started is announced, so past deposits never arrive as new
 * notifications. The cron checks the least recently checked accounts; opening
 * the app checks the customer's own account at once.
 */
const ACTIVE_MS = 30 * 24 * 3600_000;
const RECHECK_MS = 30_000;

export async function watchAccount(db: D1Database, subject: string, wallet: string, now = new Date()) {
  const at = now.toISOString();
  await db.prepare(`INSERT INTO incoming_watches (subject_reference, wallet_address, watched_since, last_active_at)
    SELECT ?1, ?2, ?3, ?3 WHERE EXISTS (SELECT 1 FROM subject_profiles WHERE subject_reference = ?1)
    ON CONFLICT (subject_reference) DO UPDATE SET wallet_address = excluded.wallet_address, last_active_at = excluded.last_active_at`)
    .bind(subject, wallet.toLowerCase(), at).run();
}

type Watch = { subject_reference: string; wallet_address: string; watched_since: string };

/** Check watched accounts for new money received and record a notice for each. Returns the customers who got one. */
export async function scanIncoming(db: D1Database, options: { subject?: string; limit?: number; now?: Date; read?: typeof readIncoming } = {}): Promise<string[]> {
  const now = options.now ?? new Date();
  const due = new Date(now.getTime() - RECHECK_MS).toISOString();
  const rows = await db.prepare(`SELECT w.subject_reference, w.wallet_address, w.watched_since FROM incoming_watches w
    JOIN subject_profiles p ON p.subject_reference = w.subject_reference
    WHERE p.closed_at IS NULL AND w.last_active_at > ?1 AND (w.checked_at IS NULL OR w.checked_at <= ?2) ${options.subject ? "AND w.subject_reference = ?3" : ""}
    ORDER BY COALESCE(w.checked_at, '') ASC LIMIT ${Math.min(options.limit ?? 20, 100)}`)
    .bind(new Date(now.getTime() - ACTIVE_MS).toISOString(), due, ...(options.subject ? [options.subject] : [])).all<Watch>();
  const notified = new Set<string>();
  for (const watch of rows.results) {
    await db.prepare("UPDATE incoming_watches SET checked_at = ? WHERE subject_reference = ?").bind(now.toISOString(), watch.subject_reference).run();
    const incoming = await (options.read ?? readIncoming)(watch.wallet_address, { exclude: await listActionHashes(db, watch.subject_reference), now });
    for (const transfer of incoming.transfers) {
      if (transfer.receivedAt < watch.watched_since) continue;
      if (await notify(db, watch.subject_reference, receivedNotice(transfer), now)) notified.add(watch.subject_reference);
    }
  }
  return [...notified];
}
