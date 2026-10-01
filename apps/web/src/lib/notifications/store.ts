import { actionEntry, entryAmount, entryLabel, incomingEntry } from "@/lib/activity/entries";
import type { IncomingTransfer } from "@/lib/activity/incoming";
import type { StoredAction } from "@/lib/actions/store";
import { networkName } from "@/lib/assets/registry";
import { failureText } from "@/lib/client/action-copy";
import { formatCents, shortAddress } from "@/lib/money/format";
import { payoutStateText } from "@/lib/providers/bridge/transfers";

/**
 * One notice per event, kept in D1 so the app can show it and email and push
 * can deliver it (`deliver.ts`). The dedupe key makes each event notify once,
 * however many times it is observed.
 */
export type NotificationKind = "received" | "completed" | "failed" | "security";
export type Notice = { kind: NotificationKind; dedupeKey: string; title: string; body: string; link?: string };
export type NotificationView = { id: string; kind: NotificationKind; title: string; body: string; link: string | null; createdAt: string; read: boolean };

// Shorten addresses only; names like a vault's stay whole.
const short = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value) ? shortAddress(value) : value;

/** Record a notice once. Returns true if it is new. */
export async function notify(db: D1Database, subject: string, notice: Notice, now = new Date()): Promise<boolean> {
  const result = await db.prepare(`INSERT INTO notifications (notification_id, subject_reference, kind, dedupe_key, title, body, link, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM subject_profiles WHERE subject_reference = ?)
    ON CONFLICT (subject_reference, dedupe_key) DO NOTHING`)
    .bind(crypto.randomUUID(), subject, notice.kind, notice.dedupeKey, notice.title, notice.body, notice.link ?? null, now.toISOString(), subject).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listNotifications(db: D1Database, subject: string, limit = 30): Promise<{ notifications: NotificationView[]; unread: number }> {
  const [rows, unread] = await db.batch([
    db.prepare(`SELECT notification_id, kind, title, body, link, created_at, read_at FROM notifications WHERE subject_reference = ?
      ORDER BY created_at DESC LIMIT ?`).bind(subject, limit),
    db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE subject_reference = ? AND read_at IS NULL").bind(subject)
  ]);
  type Row = { notification_id: string; kind: NotificationKind; title: string; body: string; link: string | null; created_at: string; read_at: string | null };
  return { notifications: (rows.results as Row[]).map((row) => ({ id: row.notification_id, kind: row.kind, title: row.title, body: row.body, link: row.link,
    createdAt: row.created_at, read: row.read_at !== null })), unread: (unread.results[0] as { n: number }).n };
}

export async function markAllRead(db: D1Database, subject: string, now = new Date()) {
  await db.prepare("UPDATE notifications SET read_at = ? WHERE subject_reference = ? AND read_at IS NULL").bind(now.toISOString(), subject).run();
}

/** A customer's own action finished: complete (in a block and matching, or delivered) or failed. */
export function actionNotice(action: StoredAction, outcome: "completed" | "failed"): Notice {
  const entry = actionEntry(action);
  const label = entryLabel(entry.type);
  const amount = entryAmount(entry);
  const link = `/app/transactions?open=${encodeURIComponent(action.id)}`;
  if (outcome === "failed") return { kind: "failed", dedupeKey: `action:${action.id}:failed`, title: `${label}${amount ? ` ${amount}` : ""} didn't go through`,
    body: failureText(action.failureReason), link };
  const where = entry.destinationChainId ? `${networkName(entry.chainId)} to ${networkName(entry.destinationChainId)}` : networkName(entry.chainId);
  // Money coming back from Earn goes from Aave or the vault to the account. Plain words: mail filters reject short
  // "Withdrawn … USDC" notices as look-alike scams.
  if (entry.type === "earn_withdraw") return { kind: "completed", dedupeKey: `action:${action.id}:completed`,
    title: `${amount ?? "Your money"} is back in your account`,
    body: `It came out of ${entry.counterparty ? short(entry.counterparty) : "Earn"} and is in your account on ${where}.`, link };
  return { kind: "completed", dedupeKey: `action:${action.id}:completed`, title: `${label}${amount ? ` ${amount}` : ""}`,
    body: `${entry.counterparty ? `To ${short(entry.counterparty)}, on` : "On"} ${where}.`, link };
}

/** A bank payout reached the bank, or came back. */
export function bankPayoutNotice(action: StoredAction, state: string): Notice {
  const entry = actionEntry(action);
  const amount = entryAmount(entry);
  const link = `/app/transactions?open=${encodeURIComponent(action.id)}`;
  if (state === "payment_processed") return { kind: "completed", dedupeKey: `bank_payout:${action.id}:processed`,
    title: `${amount ?? "Your payout"} arrived at your bank`, body: `${entry.counterparty ?? "Your bank account"} has it.`, link };
  return { kind: "failed", dedupeKey: `bank_payout:${action.id}:${state}`, title: `${amount ?? "Your payout"} didn't reach your bank`,
    body: `${payoutStateText(state)}.`, link };
}

/** A card purchase was approved or declined. */
export function cardSpendNotice(spend: { authorizationId: string; amountCents: number; approved: boolean; merchant: string | null }): Notice {
  const amount = `$${formatCents(Math.abs(spend.amountCents))}`;
  const where = spend.merchant ? ` at ${spend.merchant}` : "";
  return spend.approved
    ? { kind: "completed", dedupeKey: `card:${spend.authorizationId}`, title: `Card: ${amount}${where}`, body: "Paid from your USDC on Base.", link: "/app/cards" }
    : { kind: "failed", dedupeKey: `card:${spend.authorizationId}`, title: `Card declined: ${amount}${where}`,
      body: "Check your card's spending allowance, daily limit, and USDC balance.", link: "/app/cards" };
}

export function receivedNotice(transfer: IncomingTransfer, bank?: { senderName: string | null; bankName: string | null }): Notice {
  const entry = incomingEntry(transfer, undefined, bank);
  return { kind: "received", dedupeKey: `received:${transfer.id}`, title: bank ? `Bank deposit: ${entryAmount(entry)}` : `Received ${entryAmount(entry)}`,
    body: bank ? `From ${entry.counterparty}, through Bridge, on ${networkName(transfer.chainId)}.` : `From ${short(transfer.from)}, on ${networkName(transfer.chainId)}.`,
    link: `/app/transactions?open=${encodeURIComponent(entry.id)}` };
}

/** Changes to the account's security. Always delivered, whatever the customer's notification choices. */
export function securityNotice(event: "locked" | "loosened" | "recipient_saved" | "bank_account_saved" | "tag_address_changed" | "closed" | "reopened"
  | "card_created" | "card_unfrozen" | "card_limit_raised", detail: string, reference: string): Notice {
  const titles = { locked: "Your account is locked", loosened: "Your controls changed", recipient_saved: "New saved recipient",
    bank_account_saved: "New bank account", tag_address_changed: "Your Aura tag's address changed",
    closed: "Your account is closed", reopened: "Your account is open again", card_created: "Your Aura card is ready",
    card_unfrozen: "Your card is unfrozen", card_limit_raised: "Your card limit went up" } as const;
  const link = event === "closed" ? "/app/support" : event.startsWith("card_") ? "/app/cards" : event === "bank_account_saved" ? "/app/send#bank"
    : event === "tag_address_changed" ? "/app/settings#tag" : "/app/settings";
  return { kind: "security", dedupeKey: `security:${event}:${reference}`, title: titles[event],
    body: `${detail} If this wasn't you, lock your account in Settings and contact support.`, link };
}
