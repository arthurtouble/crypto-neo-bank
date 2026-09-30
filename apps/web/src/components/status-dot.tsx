import type { ActivityEntry } from "@/lib/activity/entries";

type EntryStatus = ActivityEntry["status"];

export type StatusTone = "positive" | "warning" | "negative" | "neutral";

/** An activity entry's status as a tone: completed is positive, pending warning, failed negative. */
export const entryTone = (status: EntryStatus): StatusTone =>
  status === "completed" ? "positive" : status === "pending" ? "warning" : status === "failed" ? "negative" : "neutral";

/**
 * A status: a 6px dot and a literal word, never colour alone
 * (docs/product/design-system.md, "Statuses"). Negative also colours the word.
 */
export function StatusDot({ tone, label, size = "caption" }: { tone: StatusTone; label: string; size?: "caption" | "small" }) {
  return <span className={`appStatus appStatus-${tone}${size === "small" ? " appStatusSmall" : ""}`}>{label}</span>;
}
