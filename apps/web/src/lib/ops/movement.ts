import { listActionsForOperator, type StoredAction } from "@/lib/actions/store";
import { BASE_CHAIN_ID } from "@/lib/assets/registry";
import { actionEntry, entryAmount, entryLabel, statusLabel } from "@/lib/activity/entries";

/**
 * Money moving on Aura across every customer, newest first: Aura actions
 * (sends, swaps, Earn, bank payouts, card allowances), money received from
 * outside Aura as the chain showed it (`incoming_observations`), and card
 * payments as Stripe reported them (`card_observations`). Status and stuck
 * filters are about Aura actions, so they leave the other two out.
 *
 * Rows are ordered by time, then origin, then ID, all newest (largest) first. The page cursor is the last row's
 * three, so rows that share an instant (transfers in one block, say) are never skipped or repeated between pages.
 */
type Origin = "aura" | "incoming" | "card";
type Cursor = { createdAt: string; origin: Origin | null; id: string | null };
type MovementFilter = { status?: StoredAction["status"]; kind?: StoredAction["kind"] | "received" | "card"; subject?: string; stuck?: boolean; before?: Cursor };
type MovementRow = { id: string; origin: Origin; label: string; amountText: string | null; statusText: string; status: string;
  subject: string; createdAt: string; counterparty: string | null; chainId: number; transactionHash: string | null; source: string };

const PAGE = 50;

/** The cursor a page hands back: the last row's time, origin, and ID. */
const writeCursor = (row: MovementRow) => btoa(JSON.stringify([row.createdAt, row.origin, row.id]));

/** A cursor from `listMovement`, or a bare ISO time (everything strictly before it); anything else is null. */
export function readMovementCursor(value: string): Cursor | null {
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) && !Number.isNaN(Date.parse(value))) return { createdAt: value, origin: null, id: null };
  try {
    const [createdAt, origin, id] = JSON.parse(atob(value)) as unknown[];
    if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt)) || (origin !== "aura" && origin !== "incoming" && origin !== "card")
      || typeof id !== "string" || id.length > 200) return null;
    return { createdAt, origin, id };
  } catch { return null; }
}

/**
 * Which of one origin's rows at the cursor's exact instant come after it: all of them (an origin that sorts before the
 * cursor's), none (one that sorts after it, or a bare time), or those with a smaller ID (the cursor's own origin).
 */
function tie(cursor: Cursor, origin: Origin): "all" | "none" | string {
  if (!cursor.origin || !cursor.id || origin > cursor.origin) return "none";
  return origin < cursor.origin ? "all" : cursor.id;
}

export async function listMovement(db: D1Database, filter: MovementFilter, now = new Date()): Promise<{ rows: MovementRow[]; next: string | null }> {
  const actionKind = filter.kind === "received" || filter.kind === "card" ? undefined : filter.kind;
  const wantActions = filter.kind !== "received" && filter.kind !== "card";
  const others = !filter.status && !filter.stuck;
  const wantIncoming = others && (!filter.kind || filter.kind === "received");
  const wantCards = others && (!filter.kind || filter.kind === "card");
  const before = filter.before;
  // One origin's subject and cursor conditions, with their values.
  const scoped = (column: string, idColumn: string, origin: Origin) => {
    const where: string[] = []; const values: string[] = [];
    if (filter.subject) { where.push("AND subject_reference = ?"); values.push(filter.subject); }
    if (before) {
      const after = tie(before, origin);
      if (after === "all") { where.push(`AND ${column} <= ?`); values.push(before.createdAt); }
      else if (after === "none") { where.push(`AND ${column} < ?`); values.push(before.createdAt); }
      else { where.push(`AND (${column} < ? OR (${column} = ? AND ${idColumn} < ?))`); values.push(before.createdAt, before.createdAt, after); }
    }
    return { where: where.join(" "), values };
  };
  const incomingScope = scoped("received_at", "transfer_id", "incoming");
  const cardScope = scoped("occurred_at", "activity_id", "card");
  const actionTie = before ? tie(before, "aura") : "none";
  const [actions, incoming, cards] = await Promise.all([
    wantActions ? listActionsForOperator(db, { ...filter, kind: actionKind, before: before?.createdAt, beforeId: actionTie === "none" ? undefined : actionTie, limit: PAGE }, now) : [],
    wantIncoming ? db.prepare(`SELECT transfer_id, subject_reference, chain_id, transaction_hash, from_address, symbol, amount, final, source, received_at
        FROM incoming_observations WHERE 1 = 1 ${incomingScope.where} ORDER BY received_at DESC, transfer_id DESC LIMIT ${PAGE}`)
      .bind(...incomingScope.values)
      .all<{ transfer_id: string; subject_reference: string; chain_id: number; transaction_hash: string; from_address: string; symbol: string; amount: string;
        final: number; source: string; received_at: string }>().then((result) => result.results) : [],
    wantCards ? db.prepare(`SELECT activity_id, subject_reference, kind, status, amount_usd, merchant, transaction_hash, dispute_status, occurred_at
        FROM card_observations WHERE 1 = 1 ${cardScope.where} ORDER BY occurred_at DESC, activity_id DESC LIMIT ${PAGE}`)
      .bind(...cardScope.values)
      .all<{ activity_id: string; subject_reference: string; kind: string; status: string; amount_usd: string; merchant: string | null; transaction_hash: string | null;
        dispute_status: string | null; occurred_at: string }>().then((result) => result.results) : []
  ]);
  const rows: MovementRow[] = [
    ...actions.map((action) => {
      const entry = actionEntry(action);
      return { id: action.id, origin: "aura" as const, label: entryLabel(entry.type), amountText: entryAmount(entry) ?? null, statusText: statusLabel(entry.status),
        status: action.status, subject: action.subject, createdAt: action.createdAt, counterparty: entry.counterparty ?? null, chainId: action.chainId,
        transactionHash: action.transactionHash, source: "Aura" };
    }),
    ...incoming.map((row) => ({ id: row.transfer_id, origin: "incoming" as const, label: "Received", amountText: `${row.amount} ${row.symbol}`,
      statusText: row.final ? "Completed" : "Completed, not final yet", status: "completed", subject: row.subject_reference, createdAt: row.received_at,
      counterparty: row.from_address, chainId: row.chain_id, transactionHash: row.transaction_hash, source: row.source })),
    ...cards.map((row) => ({ id: row.activity_id, origin: "card" as const, label: row.kind === "refund" ? "Card refund" : "Card payment", amountText: `${row.amount_usd} USD`,
      statusText: row.status === "completed" ? (row.dispute_status ? `Completed, dispute ${row.dispute_status}` : "Completed")
        : row.status === "pending" ? "Pending" : row.status === "declined" ? "Declined" : "Hold released",
      status: row.status === "declined" ? "failed" : row.status, subject: row.subject_reference, createdAt: row.occurred_at,
      counterparty: row.merchant, chainId: BASE_CHAIN_ID, transactionHash: row.transaction_hash, source: "Stripe" }))
  ].sort(newestFirst).slice(0, PAGE);
  const more = actions.length === PAGE || incoming.length === PAGE || cards.length === PAGE;
  return { rows, next: more && rows.length ? writeCursor(rows.at(-1)!) : null };
}

/** Time, then origin, then ID, largest first, compared as SQLite compares text. */
function newestFirst(a: MovementRow, b: MovementRow): number {
  for (const [x, y] of [[a.createdAt, b.createdAt], [a.origin, b.origin], [a.id, b.id]]) if (x !== y) return x < y ? 1 : -1;
  return 0;
}
