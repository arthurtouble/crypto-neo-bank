import { entryCategory, entryDirection, type ActivityEntry } from "@/lib/activity/entries";

/**
 * Totals for a period from completed activity: money in (received), money
 * out (sent), put to work (added to Earn), and moved (swaps and moves between
 * networks). Anything without a dollar value is counted separately, never
 * as zero.
 */
export function buildInsights(entries: ActivityEntry[], now = new Date(), days = 30) {
  const start = now.getTime() - days * 86_400_000;
  const completed = entries.filter((entry) => entry.status === "completed" && Date.parse(entry.createdAt) >= start);
  const totals = { incoming: 0, outgoing: 0, allocation: 0, movement: 0, unvalued: 0 };
  const categories = new Map<string, number>();
  for (const entry of completed) {
    const value = entry.estimatedUsd;
    if (value === undefined || !Number.isFinite(value) || value < 0) { totals.unvalued += 1; continue; }
    const direction = entryDirection(entry.type);
    if (direction === "in") totals.incoming += value;
    if (direction === "out") totals.outgoing += value;
    if (direction === "earn") totals.allocation += value;
    if (direction === "moved") totals.movement += value;
    const category = entryCategory(entry.type);
    categories.set(category, (categories.get(category) ?? 0) + value);
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    periodDays: days,
    completedCount: completed.length,
    totals: { incoming: round(totals.incoming), outgoing: round(totals.outgoing), allocation: round(totals.allocation), movement: round(totals.movement), unvalued: totals.unvalued },
    categories: [...categories.entries()].map(([name, value]) => ({ name, value: round(value) })).sort((a, b) => b.value - a.value)
  };
}
