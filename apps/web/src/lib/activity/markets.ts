import { BASE_CHAIN_ID } from "@/lib/assets/registry";
import { listWithdrawals, type MarketOperation } from "@/lib/markets/accounts";
import { marketWithdrawalEntry, type ActivityEntry } from "./entries";

/**
 * A withdrawal from perps (Hyperliquid, paid out through Circle's CCTP) or
 * predictions (Polymarket's bridge) arrives on Base as a USDC transfer that
 * no Aura action made, from an address that says nothing about where it came
 * from. This labels such a transfer as the withdrawal it is: USDC on Base to
 * the address the customer withdrew to, within a day of the withdrawal, for
 * the amount less at most the venue's fee. Each withdrawal labels one
 * transfer, the earliest that fits. The transfer stays what the chain says;
 * only its description changes, so a missed match shows as "Received".
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;
/** Hyperliquid charges $1 to withdraw; Polymarket's bridge less. */
const MAX_FEE = 2;

export function labelMarketWithdrawals(entries: ActivityEntry[], withdrawals: MarketOperation[], wallet: string): ActivityEntry[] {
  const open = withdrawals
    .filter((item) => item.status === "accepted" || item.status === "submitted")
    .filter((item) => typeof item.summary.destination === "string" && item.summary.destination.toLowerCase() === wallet.toLowerCase())
    .filter((item) => typeof item.summary.amount === "string" && Number(item.summary.amount) > 0)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (open.length === 0) return entries;
  const labelled = new Map<string, ActivityEntry>();
  const arrivals = entries.filter((entry) => entry.origin === "incoming" && entry.type === "received" && entry.chainId === BASE_CHAIN_ID && entry.asset === "USDC")
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const withdrawal of open) {
    const at = Date.parse(withdrawal.createdAt);
    const requested = Number(withdrawal.summary.amount);
    const match = arrivals.find((entry) => {
      const received = Number(entry.amount);
      const when = Date.parse(entry.createdAt);
      return !labelled.has(entry.id) && when >= at && when - at <= WINDOW_MS && received <= requested && received >= requested - MAX_FEE;
    });
    if (match) labelled.set(match.id, marketWithdrawalEntry(match, withdrawal.venue === "hyperliquid" ? "perps" : "predictions"));
  }
  return entries.map((entry) => labelled.get(entry.id) ?? entry);
}

/** The customer's recent withdrawals from both venues; a failed read labels nothing rather than hiding activity. */
export async function readMarketWithdrawals(db: D1Database, subject: string): Promise<MarketOperation[]> {
  return listWithdrawals(db, subject).catch(() => []);
}
