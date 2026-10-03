import { entryDirection, type ActivityEntry } from "@/lib/activity/entries";

export type InsightBucket = { start: string; incoming: number; outgoing: number };
export type InsightMerchant = { name: string; total: number; payments: number };

/** Days for the 7-day view, weeks (from Monday) up to 90 days, and months for a year, all in UTC. */
function bucketUnit(days: number): "day" | "week" | "month" {
  return days <= 7 ? "day" : days <= 90 ? "week" : "month";
}

function bucketStart(time: number, unit: "day" | "week" | "month") {
  const date = new Date(time);
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (unit === "day") return day;
  if (unit === "week") return day - ((date.getUTCDay() + 6) % 7) * 86_400_000;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function nextBucket(start: number, unit: "day" | "week" | "month") {
  if (unit === "day") return start + 86_400_000;
  if (unit === "week") return start + 7 * 86_400_000;
  const date = new Date(start);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Totals for a period from completed activity: money in (received, and card
 * refunds), money out (sent, and card payments), put to work (added to Earn),
 * and moved (swaps and moves between networks); money in and out over time;
 * and the card merchants paid most. Anything without a dollar value is counted
 * separately, never as zero.
 */
export function buildInsights(entries: ActivityEntry[], now = new Date(), days = 30) {
  const start = now.getTime() - days * 86_400_000;
  const completed = entries.filter((entry) => entry.status === "completed" && Date.parse(entry.createdAt) >= start);
  const totals = { incoming: 0, outgoing: 0, allocation: 0, movement: 0, unvalued: 0 };
  const unit = bucketUnit(days);
  const buckets = new Map<number, InsightBucket>();
  for (let at = bucketStart(start, unit); at <= now.getTime(); at = nextBucket(at, unit)) buckets.set(at, { start: new Date(at).toISOString(), incoming: 0, outgoing: 0 });
  const merchants = new Map<string, InsightMerchant>();
  for (const entry of completed) {
    const value = entry.estimatedUsd;
    if (value === undefined || !Number.isFinite(value) || value < 0) { totals.unvalued += 1; continue; }
    const direction = entryDirection(entry.type);
    const bucket = buckets.get(bucketStart(Date.parse(entry.createdAt), unit));
    if (direction === "in") { totals.incoming += value; if (bucket) bucket.incoming += value; }
    if (direction === "out") { totals.outgoing += value; if (bucket) bucket.outgoing += value; }
    if (direction === "earn") totals.allocation += value;
    if (direction === "moved") totals.movement += value;
    if (entry.type === "card_payment") {
      const name = entry.counterparty ?? "Card payment";
      const merchant = merchants.get(name) ?? { name, total: 0, payments: 0 };
      merchants.set(name, { name, total: merchant.total + value, payments: merchant.payments + 1 });
    }
  }
  return {
    periodDays: days,
    completedCount: completed.length,
    totals: { incoming: round(totals.incoming), outgoing: round(totals.outgoing), allocation: round(totals.allocation), movement: round(totals.movement), unvalued: totals.unvalued },
    over: { unit, buckets: [...buckets.values()].map((bucket) => ({ ...bucket, incoming: round(bucket.incoming), outgoing: round(bucket.outgoing) })) },
    topMerchants: [...merchants.values()].map((merchant) => ({ ...merchant, total: round(merchant.total) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 5)
  };
}
