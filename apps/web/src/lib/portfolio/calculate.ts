import type { DayCoverage, HistoricalEvent, HistoryPoint, PriceObservation } from "./types";

const SCALE = 10n ** 18n;
const signedInteger = /^-?(?:0|[1-9]\d*)$/;
const decimal = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;

function scaledDecimal(value: string): bigint | null {
  if (!decimal.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
  return scaled > 0n ? scaled : null;
}

function formatScaled(value: bigint): string {
  const negative = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return `${negative}${absolute / SCALE}${fraction ? `.${fraction}` : ""}`;
}

function sourceRole(event: HistoricalEvent): string | null {
  try {
    const evidence = JSON.parse(event.evidenceJson) as unknown;
    return evidence && typeof evidence === "object" && "role" in evidence && typeof evidence.role === "string" ? evidence.role : null;
  } catch { return null; }
}

/** Builds only days for which every included source and held asset is covered. */
export function calculatePortfolioDays(input: {
  events: HistoricalEvent[];
  prices: PriceObservation[];
  coverage: DayCoverage[];
  calculationVersion: number;
}): { points: HistoryPoint[] } {
  if (!Number.isSafeInteger(input.calculationVersion) || input.calculationVersion < 1) throw new Error("Invalid portfolio calculation version.");
  const days = [...new Set(input.coverage.map((row) => row.day))].sort();
  const accounts = new Set(input.events.map((event) => event.accountId));
  const balances = new Map<string, { raw: bigint; decimals: number; assetId: string }>();
  const prices = new Map<string, bigint>();
  const invalidPrices = new Set<string>();
  for (const price of input.prices) {
    const key = `${price.assetId}|${price.day}`;
    const parsed = scaledDecimal(price.usd);
    if (prices.has(key) || invalidPrices.has(key) || parsed === null) { prices.delete(key); invalidPrices.add(key); }
    else prices.set(key, parsed);
  }
  let previousValue: bigint | null = null;
  let twr: bigint | null = null;
  let everComplete = false;
  let eventContinuityLost = false;
  const points: HistoryPoint[] = [];
  for (const day of days) {
    const reasons: string[] = [];
    const coverage = input.coverage.filter((row) => row.day === day);
    if (!coverage.length || [...accounts].some((account) => !coverage.some((row) => row.accountId === account))) reasons.push("missing_source_coverage");
    for (const row of coverage) {
      if (row.eventStatus !== "complete") reasons.push(row.reason ?? "incomplete_source");
      if (row.priceStatus !== "complete") reasons.push(row.reason ?? "incomplete_price_source");
    }
    const dayEvents = input.events.filter((event) => event.occurredAt.slice(0, 10) === day);
    let flowUsd = 0n;
    for (const event of dayEvents) {
      if (event.finality !== "finalized" || event.completeness !== "complete" || !signedInteger.test(event.rawDelta)
        || !Number.isInteger(event.decimals) || event.decimals < 0 || event.decimals > 36) {
        reasons.push("incomplete_event");
        eventContinuityLost = true;
        continue;
      }
      if (sourceRole(event) === "position_receipt") continue;
      const key = `${event.accountId}|${event.assetId}`;
      const existing = balances.get(key);
      if (existing && existing.decimals !== event.decimals) { reasons.push("conflicting_decimals"); eventContinuityLost = true; continue; }
      balances.set(key, { raw: (existing?.raw ?? 0n) + BigInt(event.rawDelta), decimals: event.decimals, assetId: event.assetId });
      if (event.kind === "contribution" || event.kind === "withdrawal") {
        const observed = prices.get(`${event.assetId}|${day}`);
        if (observed === undefined) reasons.push("missing_flow_price");
        else flowUsd += BigInt(event.rawDelta) * observed / 10n ** BigInt(event.decimals);
      }
    }
    if (eventContinuityLost) reasons.push("incomplete_event_history");
    let value = 0n;
    for (const balance of balances.values()) {
      if (balance.raw === 0n) continue;
      const observed = prices.get(`${balance.assetId}|${day}`);
      if (observed === undefined) reasons.push("missing_price");
      else value += balance.raw * observed / 10n ** BigInt(balance.decimals);
    }
    if (reasons.length) {
      points.push({ day, netValueUsd: null, twrIndex: null, status: "partial", reasons: [...new Set(reasons)] });
      previousValue = null;
      twr = null;
      continue;
    }
    if (!everComplete && value > 0n) twr = SCALE;
    else if (previousValue !== null && previousValue > 0n && twr !== null) {
      const flowAdjusted = value - flowUsd;
      twr = flowAdjusted >= 0n ? twr * flowAdjusted / previousValue : null;
    } else twr = null;
    points.push({ day, netValueUsd: formatScaled(value), twrIndex: twr === null ? null : formatScaled(twr), status: "complete", reasons: [] });
    everComplete = true;
    previousValue = value;
  }
  return { points };
}
