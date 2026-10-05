import { actionEntry, entryAmount, entryLabel, incomingEntry, type ActivityEntry } from "@/lib/activity/entries";
import type { IncomingTransfer } from "@/lib/activity/incoming";
import type { StoredAction } from "@/lib/actions/store";
import { BASE_CHAIN_ID, networkName } from "@/lib/assets/registry";
import { failureText } from "@/lib/client/action-copy";
import { formatCents, formatToken, formatUsd, shortAddress } from "@/lib/format";
import { payoutStateText } from "@/lib/providers/bridge/transfers";

/**
 * One notice per event, kept in D1 so the app can show it and email and push
 * can deliver it (`deliver.ts`). The dedupe key makes each event notify once,
 * however many times it is observed.
 */
export type NotificationKind = "received" | "completed" | "failed" | "security";
export type Notice = { kind: NotificationKind; dedupeKey: string; title: string; body: string; link?: string };
/** `key` names what the notice is about (`security:recipient_saved:<entry>`), so a screen that just did it can skip the toast. */
export type NotificationView = { id: string; key: string; kind: NotificationKind; title: string; body: string; link: string | null; createdAt: string; read: boolean };

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
    db.prepare(`SELECT notification_id, dedupe_key, kind, title, body, link, created_at, read_at FROM notifications WHERE subject_reference = ?
      ORDER BY created_at DESC LIMIT ?`).bind(subject, limit),
    db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE subject_reference = ? AND read_at IS NULL").bind(subject)
  ]);
  type Row = { notification_id: string; dedupe_key: string; kind: NotificationKind; title: string; body: string; link: string | null; created_at: string; read_at: string | null };
  return { notifications: (rows.results as Row[]).map((row) => ({ id: row.notification_id, key: row.dedupe_key, kind: row.kind, title: row.title, body: row.body, link: row.link,
    createdAt: row.created_at, read: row.read_at !== null })), unread: (unread.results[0] as { n: number }).n };
}

export async function markAllRead(db: D1Database, subject: string, now = new Date()) {
  await db.prepare("UPDATE notifications SET read_at = ? WHERE subject_reference = ? AND read_at IS NULL").bind(now.toISOString(), subject).run();
}

/** An amount as the receipt shows it: "$12.00", "0.123457 ETH", "1,000 USDC". */
const money = (amount: string, asset?: string) => asset === "USD" ? formatUsd(amount) : formatToken(amount, asset);

/** The network, as the receipt names it: only when the money isn't simply on Base. */
function where(entry: ActivityEntry): string | undefined {
  const to = entry.destinationChainId && entry.destinationChainId !== entry.chainId ? entry.destinationChainId : undefined;
  if (entry.chainId === BASE_CHAIN_ID && !to) return undefined;
  return to ? `from ${networkName(entry.chainId)} to ${networkName(to)}` : `on ${networkName(entry.chainId)}`;
}

/** What failed, in the progress card's words ("Send failed"), for the kinds whose receipt title is a past tense. */
const failedName: Partial<Record<ActivityEntry["type"], string>> = { sent: "Send", swap: "Swap", bridge: "Move between networks",
  earn_deposit: "Deposit to Earn", earn_withdraw: "Withdrawal from Earn", perps_deposit: "Deposit to perps", predictions_deposit: "Deposit to predictions",
  bank_payout: "Bank transfer", card_allowance: "Card allowance", card_spending_off: "Turning off card spending" };

/**
 * A customer's own action finished: complete (in a block and matching, or delivered) or failed. Worded like its
 * receipt, which the notice opens: the same amounts, the same "To" and "From", the network only when it isn't Base,
 * and the receipt's Reason when it failed. A bank transfer is complete only when the bank has it
 * (`bankPayoutNotice`), so its funding on Base announces nothing.
 */
export function actionNotice(action: StoredAction, outcome: "completed" | "failed"): Notice | null {
  const entry = actionEntry(action);
  const amount = entryAmount(entry) === undefined ? undefined : entry.toAmount && entry.toAsset && (entry.type === "swap" || entry.type === "bridge")
    ? `${money(entry.amount!, entry.asset)} for ${money(entry.toAmount, entry.toAsset)}` : money(entry.amount!, entry.asset);
  const paid = entry.amount ? money(entry.amount, entry.asset) : undefined;
  const who = entry.counterparty ? short(entry.counterparty) : undefined;
  const network = where(entry);
  const link = `/app/transactions?open=${encodeURIComponent(action.id)}`;
  if (outcome === "failed") return { kind: "failed", dedupeKey: `action:${action.id}:failed`,
    title: `${failedName[entry.type] ?? entryLabel(entry.type)} failed${amount && entry.type !== "card_spending_off" ? `: ${amount}` : ""}`,
    body: failureText(action.failureReason), link };
  if (entry.type === "bank_payout") return null;
  const done = (title: string, body: string): Notice => ({ kind: "completed", dedupeKey: `action:${action.id}:completed`, title, body, link });
  const sentence = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}.`;
  switch (entry.type) {
    case "sent": return done(`Sent ${amount ?? ""}`.trim(), sentence(`to ${who ?? "the recipient"}${network ? `, ${network}` : ""}`));
    case "swap": return done(`Swapped ${amount ?? ""}`.trim(), sentence(`it's in your account${network ? ` ${network}` : ""}`));
    case "bridge": return done(`Moved ${paid ?? "money"} between networks`,
      `${sentence(network ?? "between networks")}${entry.toAmount && entry.toAsset ? ` ${money(entry.toAmount, entry.toAsset)} arrived.` : ""}`);
    // Money coming back from Earn goes from Aave or the vault to the account. Plain words: mail filters reject short
    // "Withdrawn … USDC" notices as look-alike scams.
    case "earn_withdraw": return done(`${paid ?? "Your money"} is back in your account`, sentence(`from ${who ?? "Earn"}${network ? `, ${network}` : ""}`));
    case "earn_deposit": return done(`Added ${paid ?? "money"} to Earn`, sentence(`to ${who ?? "Earn"}`));
    case "perps_deposit": return done(`Added ${paid ?? "money"} to perps`, sentence(`to ${who ?? "perps"}`));
    case "predictions_deposit": return done(`Added ${paid ?? "money"} to predictions`, sentence(`to ${who ?? "predictions"}`));
    case "card_allowance": return done(`Card allowance set to ${paid ?? "a new amount"}`, `Your card can spend up to ${paid ?? "this amount"} from your account.`);
    case "card_spending_off": return done("Card spending turned off", "Your card can't spend until you set an allowance again.");
    default: return done(`${entryLabel(entry.type)}${amount ? ` ${amount}` : ""}`, sentence(`${who ? `to ${who}` : "completed"}${network ? `, ${network}` : ""}`));
  }
}

/** A bank transfer reached the bank, or came back. */
export function bankPayoutNotice(action: StoredAction, state: string): Notice {
  const entry = actionEntry(action);
  const amount = entry.amount ? money(entry.amount, entry.asset) : undefined;
  const link = `/app/transactions?open=${encodeURIComponent(action.id)}`;
  if (state === "payment_processed") return { kind: "completed", dedupeKey: `bank_payout:${action.id}:processed`,
    title: `${amount ?? "Your bank transfer"} arrived at your bank`, body: `${entry.counterparty ?? "Your bank account"} has it.`, link };
  return { kind: "failed", dedupeKey: `bank_payout:${action.id}:${state}`, title: `${amount ?? "Your bank transfer"} didn't reach your bank`,
    body: `${payoutStateText(state)}.`, link };
}

/** A card payment was approved or declined, in the receipt's words. */
export function cardSpendNotice(spend: { authorizationId: string; amountCents: number; approved: boolean; merchant: string | null }): Notice {
  const amount = formatCents(Math.abs(spend.amountCents));
  const at = spend.merchant ? ` at ${spend.merchant}` : "";
  return spend.approved
    ? { kind: "completed", dedupeKey: `card:${spend.authorizationId}`, title: `Card payment: ${amount}${at}`, body: "Paid with your card from your USDC.", link: "/app/cards" }
    : { kind: "failed", dedupeKey: `card:${spend.authorizationId}`, title: `Card payment declined: ${amount}${at}`,
      body: "No money moved. Check your card allowance, daily limit, and USDC balance.", link: "/app/cards" };
}

const MARKET_NAMES = { perps: "Hyperliquid", predictions: "Polymarket" } as const;

/**
 * Money received, a bank deposit, or a withdrawal from perps or predictions arriving (matched the way Transactions
 * matches it, `lib/activity/markets.ts`).
 */
export function receivedNotice(transfer: IncomingTransfer, bank?: { senderName: string | null; bankName: string | null }, market?: "perps" | "predictions"): Notice {
  const entry = incomingEntry(transfer, undefined, bank);
  const amount = money(transfer.amount, transfer.symbol);
  const link = `/app/transactions?open=${encodeURIComponent(entry.id)}`;
  const network = where(entry);
  const base = { kind: "received" as const, dedupeKey: `received:${transfer.id}`, link };
  if (market) return { ...base, title: `${amount} is back in your account`, body: `Withdrawn from ${market} at ${MARKET_NAMES[market]}.` };
  if (bank) return { ...base, title: `Bank deposit: ${amount}`, body: `From ${entry.counterparty}.` };
  return { ...base, title: `Received ${amount}`, body: `From ${short(transfer.from)}${network ? `, ${network}` : ""}.` };
}

/** A time in a notice, the same in the app and in email: "2 Oct 2026, 15:24 UTC". */
export function noticeTime(iso: string): string {
  const date = new Date(iso);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}, ${date.toISOString().slice(11, 16)} UTC`;
}

/** What to do if the customer didn't make a security change: lock where it could be someone else's; otherwise ask. */
const ifNotYou = "If this wasn't you, lock your account in Settings and contact support.";
const advice: Partial<Record<SecurityEvent, string>> = { locked: "If you didn't lock it, contact support.",
  closed: "If you didn't ask for this, contact support.", reopened: "If you didn't ask for this, contact support." };
type SecurityEvent = "locked" | "loosened" | "recipient_saved" | "bank_account_saved" | "bank_account_removed" | "tag_address_changed" | "closed"
  | "reopened" | "card_created" | "card_replaced" | "card_unfrozen" | "card_limit_raised";

/**
 * Changes to the account's security. Always delivered, whatever the customer's notification choices. Each ends with
 * what to do if it wasn't them, unless the caller says otherwise (a lock Aura's team made says why to get in touch).
 */
export function securityNotice(event: SecurityEvent, detail: string, reference: string, options: { advice?: string } = {}): Notice {
  const titles = { locked: "Your account is locked", loosened: "Your controls changed", recipient_saved: "New saved recipient",
    bank_account_saved: "New bank account", bank_account_removed: "Bank account removed", tag_address_changed: "Your Aura tag's address changed",
    closed: "Your account is closed", reopened: "Your account is open again", card_created: "Your Aura card is ready", card_replaced: "Your card was replaced",
    card_unfrozen: "Your card is unfrozen", card_limit_raised: "Your card limit went up" } as const;
  const link = event === "closed" ? "/app/support" : event.startsWith("card_") ? "/app/cards" : event.startsWith("bank_account_") ? "/app/send#bank"
    : event === "tag_address_changed" ? "/app/settings#tag" : "/app/settings";
  return { kind: "security", dedupeKey: `security:${event}:${reference}`, title: titles[event],
    body: `${detail} ${options.advice ?? advice[event] ?? ifNotYou}`, link };
}
