import type { BasisDisposal, BasisLot, DayCoverage, HistoricalEvent, HistoryPoint, PriceObservation } from "./types";

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

type MutableLot = BasisLot & { remaining: bigint; remainingBasis: bigint | null };

function documentedMoney(event: HistoricalEvent, field: "acquisitionCostUsd" | "disposalProceedsUsd"): bigint | null {
  try {
    const evidence = JSON.parse(event.evidenceJson) as { taxSupport?: Record<string, unknown> };
    const tax = evidence.taxSupport;
    if (!tax || typeof tax.evidenceReference !== "string" || !tax.evidenceReference.trim() || typeof tax[field] !== "string") return null;
    const value = tax[field];
    if (!decimal.test(value)) return null;
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
  } catch { return null; }
}

function calculateBasis(events: HistoricalEvent[], coverage: DayCoverage[], calculationVersion: number): { lots: BasisLot[]; disposals: BasisDisposal[] } {
  const byAssetAccount = new Map<string, MutableLot[]>();
  const disposals: BasisDisposal[] = [];
  const finalized = events.filter((event) => event.finality === "finalized" && event.completeness === "complete" && signedInteger.test(event.rawDelta)
    && event.decimals >= 0 && event.decimals <= 36 && sourceRole(event) !== "position_receipt" && sourceRole(event) !== "liability"
    && sourceRole(event) !== "protocol_activity")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)
      || (a.groupId && a.groupId === b.groupId && a.kind === "internal_transfer" && b.kind === "internal_transfer"
        ? (BigInt(a.rawDelta) < 0n ? -1 : 1) : 0)
      || a.sourceId.localeCompare(b.sourceId) || a.sourceEventId.localeCompare(b.sourceEventId));
  const transferPairs = new Map<HistoricalEvent, HistoricalEvent>();
  const pairedIncoming = new Set<HistoricalEvent>();
  for (const outgoing of finalized) {
    if (outgoing.kind !== "internal_transfer" || BigInt(outgoing.rawDelta) >= 0n || !outgoing.groupId) continue;
    const incoming = finalized.find((candidate) => candidate !== outgoing && !pairedIncoming.has(candidate)
      && candidate.kind === "internal_transfer" && candidate.groupId === outgoing.groupId
      && candidate.accountId === outgoing.counterpartyAccountId && candidate.counterpartyAccountId === outgoing.accountId
      && candidate.assetId === outgoing.assetId && BigInt(candidate.rawDelta) === -BigInt(outgoing.rawDelta));
    if (incoming) { transferPairs.set(outgoing, incoming); pairedIncoming.add(incoming); }
  }
  // Documented transaction consideration is independent of daily-close
  // valuation. An unpriced chart day must not erase otherwise evidenced FIFO.
  const incompleteAccounts = new Set(coverage.filter((row) => row.eventStatus !== "complete")
    .map((row) => row.accountId));
  for (const event of events) {
    if (event.finality !== "finalized" || event.completeness !== "complete" || event.kind === "unknown"
      || !coverage.some((row) => row.accountId === event.accountId && row.day === event.occurredAt.slice(0, 10) && row.eventStatus === "complete")) {
      incompleteAccounts.add(event.accountId);
    }
  }
  const accountKey = (event: HistoricalEvent) => `${event.accountId}|${event.assetId}`;
  const sourceKey = (event: HistoricalEvent) => `${event.sourceId}:${event.sourceEventId}`;
  const takeLots = (event: HistoricalEvent, quantity: bigint) => {
    let needed = quantity;
    const pieces: Array<{ units: bigint; basis: bigint | null; source: MutableLot }> = [];
    for (const lot of byAssetAccount.get(accountKey(event)) ?? []) {
      if (needed === 0n) break;
      const taken = needed < lot.remaining ? needed : lot.remaining;
      if (taken <= 0n) continue;
      const basis = lot.remainingBasis === null ? null : lot.remainingBasis * taken / lot.remaining;
      lot.remaining -= taken;
      if (basis !== null) lot.remainingBasis! -= basis;
      lot.rawRemaining = lot.remaining.toString();
      lot.basisUsd = lot.remainingBasis === null ? null : formatScaled(lot.remainingBasis);
      pieces.push({ units: taken, basis, source: lot });
      needed -= taken;
    }
    return { pieces, missing: needed };
  };
  for (const event of finalized) {
    if (pairedIncoming.has(event)) continue;
    const delta = BigInt(event.rawDelta);
    if (delta === 0n) continue;
    if (delta > 0n) {
      const basis = !incompleteAccounts.has(event.accountId) && (event.kind === "contribution" || event.kind === "swap")
        ? documentedMoney(event, "acquisitionCostUsd") : null;
      const lot: MutableLot = {
        accountId: event.accountId, assetId: event.assetId, sourceEventId: sourceKey(event), calculationVersion,
        acquiredAt: event.occurredAt, rawAcquired: delta.toString(), rawRemaining: delta.toString(),
        basisUsd: basis === null ? null : formatScaled(basis), classification: basis === null ? "review_required" : "supported",
        evidenceJson: event.evidenceJson, remaining: delta, remainingBasis: basis
      };
      byAssetAccount.set(accountKey(event), [...(byAssetAccount.get(accountKey(event)) ?? []), lot]);
      continue;
    }
    const quantity = -delta;
    const { pieces, missing } = takeLots(event, quantity);
    if (event.kind === "internal_transfer") {
      const incoming = transferPairs.get(event);
      if (incoming) {
        for (const [index, piece] of pieces.entries()) {
          const moved: MutableLot = {
            accountId: incoming.accountId, assetId: event.assetId,
            sourceEventId: `${sourceKey(incoming)}:basis-${index}`, calculationVersion,
            acquiredAt: piece.source.acquiredAt, rawAcquired: piece.units.toString(), rawRemaining: piece.units.toString(),
            basisUsd: piece.basis === null ? null : formatScaled(piece.basis),
            classification: piece.basis === null ? "review_required" : "supported",
            evidenceJson: incoming.evidenceJson, remaining: piece.units, remainingBasis: piece.basis
          };
          byAssetAccount.set(accountKey(incoming), [...(byAssetAccount.get(accountKey(incoming)) ?? []), moved]);
        }
        if (missing > 0n) {
          const unresolved: MutableLot = {
            accountId: incoming.accountId, assetId: incoming.assetId, sourceEventId: `${sourceKey(incoming)}:unresolved`,
            calculationVersion, acquiredAt: incoming.occurredAt, rawAcquired: missing.toString(), rawRemaining: missing.toString(),
            basisUsd: null, classification: "review_required", evidenceJson: incoming.evidenceJson, remaining: missing, remainingBasis: null
          };
          byAssetAccount.set(accountKey(incoming), [...(byAssetAccount.get(accountKey(incoming)) ?? []), unresolved]);
        }
        continue;
      }
    }
    const basis = missing === 0n && pieces.every((piece) => piece.basis !== null)
      ? pieces.reduce((sum, piece) => sum + piece.basis!, 0n) : null;
    // Only an identified swap can use documented consideration as sale proceeds.
    // Transfers, fees and unclassified debits retain their evidence for review.
    const proceeds = event.kind === "swap" ? documentedMoney(event, "disposalProceedsUsd") : null;
    const supported = basis !== null && proceeds !== null && event.kind === "swap" && !incompleteAccounts.has(event.accountId);
    disposals.push({ accountId: event.accountId, assetId: event.assetId, sourceEventId: sourceKey(event), legIndex: 0,
      calculationVersion, disposedAt: event.occurredAt, rawUnits: quantity.toString(),
      proceedsUsd: proceeds === null ? null : formatScaled(proceeds), basisUsd: basis === null ? null : formatScaled(basis),
      gainUsd: supported ? formatScaled(proceeds - basis) : null, classification: supported ? "supported" : "review_required",
      evidenceJson: event.evidenceJson });
  }
  const lots: BasisLot[] = [...byAssetAccount.values()].flat().map((lot) => ({
    accountId: lot.accountId, assetId: lot.assetId, sourceEventId: lot.sourceEventId, calculationVersion: lot.calculationVersion,
    acquiredAt: lot.acquiredAt, rawAcquired: lot.rawAcquired, rawRemaining: lot.rawRemaining,
    basisUsd: lot.basisUsd, classification: lot.classification, evidenceJson: lot.evidenceJson
  }));
  return { lots, disposals };
}

/** Builds only days for which every included source and held asset is covered. */
export function calculatePortfolioDays(input: {
  events: HistoricalEvent[];
  prices: PriceObservation[];
  coverage: DayCoverage[];
  calculationVersion: number;
}): { points: HistoryPoint[]; lots: BasisLot[]; disposals: BasisDisposal[] } {
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
  let protocolHistoryIncomplete = false;
  let returnContinuityLost = false;
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
      if (sourceRole(event) === "protocol_activity") { protocolHistoryIncomplete = true; continue; }
      if (event.kind === "unknown") returnContinuityLost = true;
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
    if (protocolHistoryIncomplete) reasons.push("protocol_position_history_unavailable");
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
    if (returnContinuityLost) twr = null;
    else if (!everComplete && value > 0n) twr = SCALE;
    else if (previousValue !== null && previousValue > 0n && twr !== null) {
      const flowAdjusted = value - flowUsd;
      twr = flowAdjusted >= 0n ? twr * flowAdjusted / previousValue : null;
    } else twr = null;
    points.push({ day, netValueUsd: formatScaled(value), twrIndex: twr === null ? null : formatScaled(twr), status: "complete",
      reasons: returnContinuityLost ? ["return_unavailable_unclassified_flow"] : [] });
    everComplete = true;
    previousValue = value;
  }
  return { points, ...calculateBasis(input.events, input.coverage, input.calculationVersion) };
}
