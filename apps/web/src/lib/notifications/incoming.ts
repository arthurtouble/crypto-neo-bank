import { readIncoming } from "@/lib/activity/incoming";
import { incomingEntry } from "@/lib/activity/entries";
import { labelMarketWithdrawals, readMarketWithdrawals } from "@/lib/activity/markets";
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
 *
 * Each check is a paid read of Alchemy's transfer index on two networks, so
 * an account is checked every 30 seconds only while its customer has the app
 * open (or did in the last RECENT_MS), and every IDLE_RECHECK_MS otherwise.
 */
const ACTIVE_MS = 30 * 24 * 3600_000;
const RECHECK_MS = 30_000;
const RECENT_MS = 15 * 60_000;
const IDLE_RECHECK_MS = 10 * 60_000;
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
export async function scanIncoming(db: D1Database, options: { subject?: string; limit?: number; now?: Date; read?: typeof readIncoming; bankDeposits?: typeof readBankDeposits;
  marketWithdrawals?: typeof readMarketWithdrawals } = {}): Promise<string[]> {
  const now = options.now ?? new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const rows = await db.prepare(`SELECT w.subject_reference, w.wallet_address, w.watched_since FROM incoming_watches w
    JOIN subject_profiles p ON p.subject_reference = w.subject_reference
    WHERE p.closed_at IS NULL AND w.last_active_at > ?1
      AND (w.checked_at IS NULL OR w.checked_at <= CASE WHEN w.last_active_at > ?2 THEN ?3 ELSE ?4 END) ${options.subject ? "AND w.subject_reference = ?5" : ""}
    ORDER BY COALESCE(w.checked_at, '') ASC LIMIT ${Math.min(options.limit ?? 20, 100)}`)
    .bind(ago(ACTIVE_MS), ago(RECENT_MS), ago(RECHECK_MS), ago(IDLE_RECHECK_MS), ...(options.subject ? [options.subject] : [])).all<Watch>();
  const notified = new Set<string>();
  for (const watch of rows.results) {
    await db.prepare("UPDATE incoming_watches SET checked_at = ? WHERE subject_reference = ?").bind(now.toISOString(), watch.subject_reference).run();
    const incoming = await (options.read ?? readIncoming)(watch.wallet_address, { exclude: await listActionHashes(db, watch.subject_reference), now });
    await recordIncoming(db, watch.subject_reference, watch.wallet_address, incoming.transfers, now);
    const announceSince = new Date(now.getTime() - ANNOUNCE_WINDOW_MS).toISOString();
    const fresh = incoming.transfers.filter((transfer) => transfer.receivedAt >= watch.watched_since && transfer.receivedAt >= announceSince);
    // A bank deposit arrives from Bridge's address; say it's from the bank.
    const bank = fresh.length ? await (options.bankDeposits ?? readBankDeposits)(db, watch.subject_reference) : new Map();
    // A withdrawal from perps or predictions arrives from an address that says nothing; match it the way Transactions does.
    const withdrawals = fresh.length ? await (options.marketWithdrawals ?? readMarketWithdrawals)(db, watch.subject_reference) : [];
    const markets = new Map<string, "perps" | "predictions">(labelMarketWithdrawals(incoming.transfers.map((transfer) => incomingEntry(transfer)), withdrawals, watch.wallet_address)
      .flatMap((entry): Array<[string, "perps" | "predictions"]> => entry.type === "perps_withdraw" ? [[entry.id, "perps"]] : entry.type === "predictions_withdraw" ? [[entry.id, "predictions"]] : []));
    for (const transfer of fresh) {
      const notice = receivedNotice(transfer, bank.get(transfer.transactionHash.toLowerCase()), markets.get(transfer.id));
      if (await notify(db, watch.subject_reference, notice, now)) notified.add(watch.subject_reference);
    }
  }
  return [...notified];
}
