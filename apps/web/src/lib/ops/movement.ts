import { listActionsForOperator, type StoredAction } from "@/lib/actions/store";
import { actionEntry, entryAmount, entryLabel, statusLabel } from "@/lib/activity/entries";

/**
 * Money moving on Aura across every customer, newest first: Aura actions
 * (sends, swaps, Earn, bank payouts, card allowances), money received from
 * outside Aura as the chain showed it (`incoming_observations`), and card
 * payments as Stripe reported them (`card_observations`). Status and stuck
 * filters are about Aura actions, so they leave the other two out.
 */
export type MovementFilter = { status?: StoredAction["status"]; kind?: StoredAction["kind"] | "received" | "card"; subject?: string; stuck?: boolean; before?: string };
export type MovementRow = { id: string; origin: "aura" | "incoming" | "card"; label: string; amountText: string | null; statusText: string; status: string;
  subject: string; createdAt: string; counterparty: string | null; chainId: number; transactionHash: string | null; source: string };

const PAGE = 50;

export async function listMovement(db: D1Database, filter: MovementFilter, now = new Date()): Promise<{ rows: MovementRow[]; next: string | null }> {
  const actionKind = filter.kind === "received" || filter.kind === "card" ? undefined : filter.kind;
  const wantActions = filter.kind !== "received" && filter.kind !== "card";
  const others = !filter.status && !filter.stuck;
  const wantIncoming = others && (!filter.kind || filter.kind === "received");
  const wantCards = others && (!filter.kind || filter.kind === "card");
  const scoped = (column: string) => [filter.subject ? "AND subject_reference = ?1" : "", filter.before ? `AND ${column} < ?${filter.subject ? 2 : 1}` : ""].join(" ");
  const scope = [filter.subject, filter.before].filter((value): value is string => Boolean(value));
  const [actions, incoming, cards] = await Promise.all([
    wantActions ? listActionsForOperator(db, { ...filter, kind: actionKind, limit: PAGE }, now) : [],
    wantIncoming ? db.prepare(`SELECT transfer_id, subject_reference, chain_id, transaction_hash, from_address, symbol, amount, final, source, received_at
        FROM incoming_observations WHERE 1 = 1 ${scoped("received_at")} ORDER BY received_at DESC LIMIT ${PAGE}`)
      .bind(...scope)
      .all<{ transfer_id: string; subject_reference: string; chain_id: number; transaction_hash: string; from_address: string; symbol: string; amount: string;
        final: number; source: string; received_at: string }>().then((result) => result.results) : [],
    wantCards ? db.prepare(`SELECT activity_id, subject_reference, kind, status, amount_usd, merchant, transaction_hash, dispute_status, occurred_at
        FROM card_observations WHERE 1 = 1 ${scoped("occurred_at")} ORDER BY occurred_at DESC LIMIT ${PAGE}`)
      .bind(...scope)
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
      counterparty: row.merchant, chainId: 8453, transactionHash: row.transaction_hash, source: "Stripe" }))
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, PAGE);
  const more = actions.length === PAGE || incoming.length === PAGE || cards.length === PAGE;
  return { rows, next: more && rows.length ? rows.at(-1)!.createdAt : null };
}
