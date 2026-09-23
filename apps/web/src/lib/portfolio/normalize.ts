import type { AccountId, HistoricalEvent } from "./types";

type Unresolved = { sourceEventId: string; reason: string };
const signedInteger = /^-?(?:0|[1-9]\d*)$/;

function evidenceRole(event: HistoricalEvent): string | null {
  try {
    const parsed = JSON.parse(event.evidenceJson) as unknown;
    return parsed && typeof parsed === "object" && "role" in parsed && typeof parsed.role === "string" ? parsed.role : null;
  } catch { return null; }
}

function sourceKey(event: HistoricalEvent): string {
  return `${event.sourceId}|${event.sourceEventId}|${event.ingestionVersion}`;
}

/** Preserve source evidence while refusing to classify a half-observed owned transfer. */
export function normalizeEconomicEvents(
  events: HistoricalEvent[],
  ownedAccounts: ReadonlySet<AccountId>
): { events: HistoricalEvent[]; unresolved: Unresolved[] } {
  const bySource = new Map<string, HistoricalEvent>();
  const conflicts = new Set<string>();
  const unresolved: Unresolved[] = [];
  for (const event of events) {
    const key = sourceKey(event);
    const prior = bySource.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(event)) conflicts.add(key);
    else if (!prior) bySource.set(key, event);
  }
  for (const key of conflicts) {
    const sourceEventId = bySource.get(key)?.sourceEventId ?? key;
    unresolved.push({ sourceEventId, reason: "conflicting_source_effect" });
    bySource.delete(key);
  }
  const unique = [...bySource.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)
    || a.sourceId.localeCompare(b.sourceId) || a.sourceEventId.localeCompare(b.sourceEventId));
  const normalized = unique.map((event) => ({ ...event }));
  for (const event of normalized) {
    if (!signedInteger.test(event.rawDelta) || event.decimals < 0 || event.decimals > 36 || !Number.isInteger(event.decimals)) {
      event.kind = "unknown";
      event.completeness = "partial";
      unresolved.push({ sourceEventId: event.sourceEventId, reason: "invalid_quantity" });
      continue;
    }
    if (!event.counterpartyAccountId || !ownedAccounts.has(event.counterpartyAccountId)) continue;
    const matches = normalized.filter((other) => other !== event && other.groupId !== null && other.groupId === event.groupId
      && other.assetId === event.assetId && other.accountId === event.counterpartyAccountId
      && other.counterpartyAccountId === event.accountId && other.logIndex === event.logIndex && signedInteger.test(other.rawDelta)
      && other.blockNumber === event.blockNumber && other.blockHash === event.blockHash && other.occurredAt === event.occurredAt
      && BigInt(other.rawDelta) === -BigInt(event.rawDelta));
    if (matches.length === 1) event.kind = "internal_transfer";
    else {
      event.kind = "unknown";
      event.completeness = "partial";
      unresolved.push({ sourceEventId: event.sourceEventId, reason: matches.length ? "ambiguous_internal_transfer" : "missing_internal_counterpart" });
    }
  }
  return { events: normalized, unresolved };
}

/** Exact raw-unit closing quantities. Never turn an incomplete source page into a balance. */
export function foldDailyQuantities(events: HistoricalEvent[], opening: ReadonlyMap<string, bigint>): Map<string, bigint> {
  const balances = new Map(opening);
  const decimals = new Map<string, number>();
  for (const event of events) {
    if (event.finality !== "finalized" || event.completeness !== "complete") throw new Error("Cannot fold incomplete portfolio events.");
    if (!signedInteger.test(event.rawDelta)) throw new Error("Invalid portfolio quantity.");
    if (evidenceRole(event) === "position_receipt") continue;
    const key = `${event.accountId}|${event.assetId}`;
    const priorDecimals = decimals.get(key);
    if (priorDecimals !== undefined && priorDecimals !== event.decimals) throw new Error("Conflicting portfolio decimals.");
    decimals.set(key, event.decimals);
    balances.set(key, (balances.get(key) ?? 0n) + BigInt(event.rawDelta));
  }
  return balances;
}
