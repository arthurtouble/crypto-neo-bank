export type InsightDirection = "incoming" | "outgoing" | "allocation" | "movement" | "other";

export type InsightInput = {
  type: string;
  status: string;
  amount?: string;
  estimatedUsd?: number;
  asset?: string;
  createdAt: string;
};

export type InsightCategory = "Transfers" | "Debt Payments" | "Borrowing" | "Earning" | "Swaps" | "Other";

export function insightCategory(type: string): InsightCategory {
  if (type === "repay") return "Debt Payments";
  if (type === "borrow") return "Borrowing";
  if (type.includes("earn") || type.includes("supply") || type.includes("withdraw_supply")) return "Earning";
  if (type.includes("swap") || type.includes("bridge") || type.includes("route")) return "Swaps";
  if (type.includes("send") || type.includes("transfer") || type.includes("withdraw")) return "Transfers";
  return "Other";
}

export function insightDirection(type: string): InsightDirection {
  if (type === "borrow") return "incoming";
  if (type === "repay" || type.includes("send") || type.includes("transfer") || type === "withdraw") return "outgoing";
  if (type.includes("earn") || type.includes("supply")) return "allocation";
  if (type.includes("swap") || type.includes("bridge") || type.includes("route")) return "movement";
  return "other";
}

export function insightUsd(item: InsightInput): number | null {
  if (typeof item.estimatedUsd === "number" && Number.isFinite(item.estimatedUsd) && item.estimatedUsd >= 0) return item.estimatedUsd;
  if ((item.asset === "USDC" || item.asset === "USD") && item.amount && /^\d+(\.\d+)?$/.test(item.amount)) return Number(item.amount);
  return null;
}

export function buildInsights(items: InsightInput[], now = new Date(), days = 30) {
  const start = now.getTime() - days * 86_400_000;
  const completed = items.filter((item) => item.status === "confirmed" && new Date(item.createdAt).getTime() >= start);
  const totals = { incoming: 0, outgoing: 0, allocation: 0, movement: 0, unvalued: 0 };
  const categories = new Map<InsightCategory, number>();
  for (const item of completed) {
    const value = insightUsd(item);
    if (value === null) { totals.unvalued += 1; continue; }
    const direction = insightDirection(item.type);
    if (direction !== "other") totals[direction] += value;
    const category = insightCategory(item.type);
    categories.set(category, (categories.get(category) ?? 0) + value);
  }
  return {
    periodDays: days,
    completedCount: completed.length,
    totals,
    categories: [...categories.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  };
}

