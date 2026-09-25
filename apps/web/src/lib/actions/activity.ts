import { formatUnits } from "viem";
import type { StoredAction } from "./store";

/** The activity-list shape the current Activity and Insights screens read. */
export function activityItem(action: StoredAction) {
  const summary = action.summary as Record<string, unknown>;
  const from = summary.from as { symbol?: string; decimals?: number } | undefined;
  const type = action.kind === "transfer" ? "transfer"
    : action.kind === "earn" ? (summary.direction === "withdraw" ? "earn_withdraw" : "earn_supply")
      : action.destinationChainId ? "bridge" : "swap";
  const amount = typeof summary.amount === "string" ? summary.amount
    : from?.decimals !== undefined && typeof summary.fromAmountRaw === "string" ? formatUnits(BigInt(summary.fromAmountRaw), from.decimals) : undefined;
  return {
    intentId: action.id, type, status: action.status === "settling" ? "submitted" : action.status,
    transactionHash: action.transactionHash ?? undefined, createdAt: action.createdAt, updatedAt: action.checkedAt ?? action.createdAt,
    confirmedAt: action.status === "confirmed" ? action.settledAt ?? undefined : undefined, failureReason: action.failureReason ?? undefined,
    chainId: action.chainId, asset: typeof summary.symbol === "string" ? summary.symbol : from?.symbol, amount,
    destination: typeof summary.to === "string" ? summary.to : typeof summary.recipient === "string" ? summary.recipient : undefined,
    estimatedUsd: action.usdCents === null ? undefined : action.usdCents / 100,
    destinationChainId: action.destinationChainId ?? undefined, destinationTransactionHash: action.destinationTransactionHash ?? undefined,
    events: [], source: "Aura", sourceKind: "projection" as const, authority: "Aura actions, verified against chain receipts"
  };
}
