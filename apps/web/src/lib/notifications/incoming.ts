import { readIncoming } from "@/lib/activity/incoming";
import { recordIncoming } from "@/lib/activity/observations";
import { listActionHashes } from "@/lib/actions/store";
import { readBankDeposits } from "@/lib/money/bank-activity";
import { RECEIVED_NOTICE_WINDOW_DAYS } from "@/lib/privacy/retention";
import { notify, receivedNotice } from "./store";

/**
 * Notices for money received. An account is watched once the customer uses
 * Aura, and for 30 days after they were last active. Only money received
 * after the watch started, and in the last RECEIVED_NOTICE_WINDOW_DAYS, is
 * announced, so past deposits never arrive as new notifications, even after
 * their old notice was cleaned up (lib/privacy/retention.ts). The cron checks the least recently checked accounts; opening
 * the app checks the customer's own account at once.
 */
const ACTIVE_MS = 30 * 24 * 3600_000;
const RECHECK_MS = 30_000;
const ANNOUNCE_WINDOW_MS = RECEIVED_NOTICE_WINDOW_DAYS * 24 * 3600_000;

export async function watchAccount(db: D1Database, subject: string, wallet: string, now = new Date()) {
  const at = now.toISOString();
  await db.prepare(`INSERT INTO incoming_watches (subject_reference, wallet_address, watched_since, last_active_at)
    SELECT ?1, ?2, ?3, ?3 WHERE EXISTS (SELECT 1 FROM subject_profiles WHERE subject_reference = ?1)
    ON CONFLICT (subject_reference) DO UPDATE SET wallet_address = excluded.wallet_address, last_active_at = excluded.last_active_at`)
    .bind(subject, wallet.toLowerCase(), at).run();
}

type Watch = { subject_reference: string; wallet_address: string; watched_since: string };

/** Check watched accounts for new money received and record a notice for each. Returns the customers who got one. */
export async function scanIncoming(db: D1Database, options: { subject?: string; limit?: number; now?: Date; read?: typeof readIncoming; bankDeposits?: typeof readBankDeposits } = {}): Promise<string[]> {
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
    await recordIncoming(db, watch.subject_reference, watch.wallet_address, incoming.transfers, now);
    const announceSince = new Date(now.getTime() - ANNOUNCE_WINDOW_MS).toISOString();
    const fresh = incoming.transfers.filter((transfer) => transfer.receivedAt >= watch.watched_since && transfer.receivedAt >= announceSince);
    // A bank deposit arrives from Bridge's address; say it's from the bank.
    const bank = fresh.length ? await (options.bankDeposits ?? readBankDeposits)(db, watch.subject_reference) : new Map();
    for (const transfer of fresh) {
      if (await notify(db, watch.subject_reference, receivedNotice(transfer, bank.get(transfer.transactionHash.toLowerCase())), now)) notified.add(watch.subject_reference);
    }
  }
  return [...notified];
}
