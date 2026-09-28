import { listActionsForOperator, type StoredAction } from "@/lib/actions/store";
import { actionEntry, entryAmount, entryLabel, statusLabel } from "@/lib/activity/entries";

/**
 * Money moving on Aura across every customer, newest first: Aura actions
 * (sends, swaps, Earn, bank payouts, card allowances) and money received from
 * outside Aura as the chain showed it (`incoming_observations`). Status, kind,
 * and stuck filters are about Aura actions, so they leave received money out.
 */
export type MovementFilter = { status?: StoredAction["status"]; kind?: StoredAction["kind"] | "received"; subject?: string; stuck?: boolean; before?: string };
export type MovementRow = { id: string; origin: "aura" | "incoming"; label: string; amountText: string | null; statusText: string; status: string;
  subject: string; createdAt: string; counterparty: string | null; chainId: number; transactionHash: string | null; source: string };

const PAGE = 50;

export async function listMovement(db: D1Database, filter: MovementFilter, now = new Date()): Promise<{ rows: MovementRow[]; next: string | null }> {
  const wantActions = filter.kind !== "received";
  const wantIncoming = !filter.status && !filter.stuck && (!filter.kind || filter.kind === "received");
  const [actions, incoming] = await Promise.all([
    wantActions ? listActionsForOperator(db, { ...filter, kind: filter.kind === "received" ? undefined : filter.kind, limit: PAGE }, now) : [],
    wantIncoming ? db.prepare(`SELECT transfer_id, subject_reference, chain_id, transaction_hash, from_address, symbol, amount, final, source, received_at
        FROM incoming_observations WHERE 1 = 1 ${filter.subject ? "AND subject_reference = ?1" : ""} ${filter.before ? `AND received_at < ?${filter.subject ? 2 : 1}` : ""}
        ORDER BY received_at DESC LIMIT ${PAGE}`)
      .bind(...[filter.subject, filter.before].filter((value): value is string => Boolean(value)))
      .all<{ transfer_id: string; subject_reference: string; chain_id: number; transaction_hash: string; from_address: string; symbol: string; amount: string;
        final: number; source: string; received_at: string }>().then((result) => result.results) : []
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
      counterparty: row.from_address, chainId: row.chain_id, transactionHash: row.transaction_hash, source: row.source }))
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, PAGE);
  const more = actions.length === PAGE || incoming.length === PAGE;
  return { rows, next: more && rows.length ? rows.at(-1)!.createdAt : null };
}
