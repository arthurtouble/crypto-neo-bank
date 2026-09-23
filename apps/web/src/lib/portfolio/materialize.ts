import type { AssetId } from "@/lib/swap/assets";
import { calculatePortfolioDays } from "./calculate";
import { normalizeEconomicEvents } from "./normalize";
import { loadObservedUsdPrices } from "./prices";
import type { AccountId, DayCoverage, HistoricalEvent, PriceObservation } from "./types";

const HISTORY_FROM = "2023-01-01T00:00:00.000Z"; // Before Base mainnet; no Base opening balance is inferred.
const REQUIRED_SOURCES = ["blockscout:8453", "aave:v3:8453"] as const;
const MAX_ACCOUNTS = 4;
const MAX_EVENTS = 1_000;
const MAX_DAYS = 1_600;
const PUBLISH_DAYS = 7;
const RETURN_WINDOW = { pricedDays: PUBLISH_DAYS, scope: "recent_completed_utc_days", inceptionReturnAvailable: false } as const;
// D1 paid Workers allow 1,000 queries per invocation; leave room for reads.
const MAX_STATEMENTS = 800;
// Increment when normalization, daily valuation, or basis semantics change.
const CALCULATION_RULE_VERSION = 3;
type Checkpoint = { account_id: string; source_id: string; cursor: string | null; covered_from: string | null; covered_through: string | null; status: string; ingestion_version: number; last_finalized_block: string | null; last_finalized_hash: string | null };
type EventRow = { source_id: string; source_event_id: string; ingestion_version: number; account_id: string; asset_id: string; raw_delta: string; decimals: number; event_kind: HistoricalEvent["kind"]; occurred_at: string; chain_id: number | null; block_number: string | null; block_hash: string | null; tx_hash: string | null; log_index: number | null; finality: HistoricalEvent["finality"]; completeness: HistoricalEvent["completeness"]; group_id: string | null; counterparty_account_id: string | null; evidence_json: string };
type Marker = { input_digest: string; calculation_version: number };
type Result = { status: "published" | "unchanged"; calculationVersion: number; inputDigest: string; days: number; returnWindow: typeof RETURN_WINDOW };

export class PortfolioMaterializeError extends Error {
  constructor(readonly code: "invalid_scope" | "incomplete_source" | "incomplete_event" | "workload_exceeded" | "price_unavailable" | "conflict", message: string) { super(message); this.name = "PortfolioMaterializeError"; }
}

function dayList(through: string): string[] {
  const first = Date.parse(HISTORY_FROM);
  const end = Date.parse(through);
  const count = Math.round((end - first) / 86_400_000);
  if (!Number.isInteger(count) || count < 1 || count > MAX_DAYS) throw new PortfolioMaterializeError("workload_exceeded", "Historical span exceeds the bounded publisher.");
  return Array.from({ length: count }, (_, index) => new Date(first + index * 86_400_000).toISOString().slice(0, 10));
}
function evidenceRole(event: HistoricalEvent): string | null {
  try { const value = JSON.parse(event.evidenceJson) as { role?: unknown }; return typeof value.role === "string" ? value.role : null; }
  catch { return null; }
}
function currentChainEvidence(event: HistoricalEvent): boolean {
  if (event.sourceId !== "blockscout:8453") return true;
  try { return (JSON.parse(event.evidenceJson) as { sourceEvidenceVersion?: unknown }).sourceEvidenceVersion === 3; }
  catch { return false; }
}
async function digest(value: unknown): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function toEvent(row: EventRow): HistoricalEvent {
  return { sourceId: row.source_id, sourceName: row.source_id, sourceEventId: row.source_event_id, ingestionVersion: row.ingestion_version,
    accountId: row.account_id as AccountId, assetId: row.asset_id as AssetId, rawDelta: row.raw_delta, decimals: row.decimals, kind: row.event_kind,
    occurredAt: row.occurred_at, chainId: row.chain_id, blockNumber: row.block_number, blockHash: row.block_hash, txHash: row.tx_hash,
    logIndex: row.log_index, finality: row.finality, completeness: row.completeness, groupId: row.group_id,
    counterpartyAccountId: row.counterparty_account_id as AccountId | null, evidenceJson: row.evidence_json };
}

/** Rebuildable analytics only. One bounded replay, one atomic append-only publication. */
export async function materializePortfolioDaily(db: D1Database, subjectReference: string, accountIds: AccountId[], options: { now?: Date } = {}): Promise<Result> {
  const accounts = [...new Set(accountIds)].sort();
  if (!subjectReference || !accounts.length || accounts.length > MAX_ACCOUNTS || accounts.some((item) => !/^8453:0x[a-f0-9]{40}$/.test(item)))
    throw new PortfolioMaterializeError("invalid_scope", "A bounded, verified Base account scope is required.");
  const now = options.now ?? new Date();
  const through = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const days = dayList(through);
  const recent = days.slice(-PUBLISH_DAYS);
  const accountPlaceholders = accounts.map(() => "?").join(",");
  const marker = await db.prepare("SELECT input_digest, calculation_version FROM portfolio_publications WHERE subject_reference = ?")
    .bind(subjectReference).first<Marker>();
  const rebuildHold = await db.prepare("SELECT rebuild_id FROM portfolio_rebuild_holds WHERE subject_reference = ?")
    .bind(subjectReference).first<{ rebuild_id: string }>();
  const [checkpointResult, eventResult] = await Promise.all([
    db.prepare(`SELECT account_id, source_id, cursor, covered_from, covered_through, status, ingestion_version, last_finalized_block, last_finalized_hash
      FROM portfolio_source_checkpoints WHERE subject_reference = ?`).bind(subjectReference).all<Checkpoint>(),
    db.prepare(`SELECT source_id, source_event_id, ingestion_version, account_id, asset_id, raw_delta, decimals, event_kind, occurred_at, chain_id,
      block_number, block_hash, tx_hash, log_index, finality, completeness, group_id, counterparty_account_id, evidence_json
      FROM portfolio_events WHERE subject_reference = ? AND account_id IN (${accountPlaceholders}) AND occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at, source_id, source_event_id LIMIT 1001`)
      .bind(subjectReference, ...accounts, HISTORY_FROM, through).all<EventRow>()
  ]);
  const checkpointMap = new Map(checkpointResult.results.map((row) => [`${row.account_id}|${row.source_id}`, row]));
  for (const account of accounts) for (const sourceId of REQUIRED_SOURCES) {
    const checkpoint = checkpointMap.get(`${account}|${sourceId}`);
    if (!checkpoint || checkpoint.status !== "complete" || checkpoint.cursor !== null || !checkpoint.covered_from || checkpoint.covered_from > HISTORY_FROM
      || !checkpoint.covered_through || checkpoint.covered_through < through)
      throw new PortfolioMaterializeError("incomplete_source", `Historical ${sourceId} coverage is incomplete for a linked account.`);
  }
  if (eventResult.results.length > MAX_EVENTS) throw new PortfolioMaterializeError("workload_exceeded", "Historical event read is truncated.");
  const allowed = new Set<string>(accounts);
  const rawEvents = eventResult.results.filter((row) => allowed.has(row.account_id)).map(toEvent);
  if (rawEvents.some((event) => event.finality !== "finalized" || event.completeness !== "complete" || !/^-?(?:0|[1-9]\d*)$/.test(event.rawDelta)
    || !Number.isInteger(event.decimals) || event.decimals < 0 || event.decimals > 36 || !Number.isInteger(event.ingestionVersion) || event.ingestionVersion < 1
    || !currentChainEvidence(event)))
    throw new PortfolioMaterializeError("incomplete_event", "Raw event history is incomplete or malformed.");
  const normalized = normalizeEconomicEvents(rawEvents, new Set(accounts));
  if (normalized.unresolved.length) throw new PortfolioMaterializeError("incomplete_event", "Economic event normalization is unresolved.");
  // Aave activity is independent protocol evidence, not a second token balance change.
  // Until historic supply/debt position legs reconcile, valuation from that day is partial.
  const events = normalized.events.map((event) => event.sourceId === "aave:v3:8453"
    ? { ...event, evidenceJson: JSON.stringify({ role: "protocol_activity", sourceEvidence: JSON.parse(event.evidenceJson) as unknown }) } : event);
  const assets = [...new Set(events.filter((event) => evidenceRole(event) !== "protocol_activity" && evidenceRole(event) !== "position_receipt")
    .map((event) => event.assetId))];
  let prices: PriceObservation[];
  try { prices = await loadObservedUsdPrices(assets, recent); }
  catch { throw new PortfolioMaterializeError("price_unavailable", "Independent observed-price source is unavailable."); }
  const validPrices = prices.filter((price) => assets.includes(price.assetId) && recent.includes(price.day)
    && /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/.test(price.usd) && price.usd !== "0" && price.version > 0 && price.sourceId);
  if (validPrices.length !== prices.length) throw new PortfolioMaterializeError("price_unavailable", "Price source returned malformed evidence.");
  const priorPrices = await Promise.all(validPrices.map((price) => db.prepare(`SELECT usd, methodology FROM portfolio_price_observations
    WHERE asset_id = ? AND day = ? AND source_id = ? AND version = ?`)
    .bind(price.assetId, price.day, price.sourceId, price.version).first<{ usd: string; methodology: string }>()));
  if (priorPrices.some((prior, index) => prior && (prior.usd !== validPrices[index].usd || prior.methodology !== validPrices[index].methodology)))
    throw new PortfolioMaterializeError("price_unavailable", "An observed price changed without a new source version.");
  const priceCounts = new Map<string, number>();
  for (const price of prices) { const key = `${price.assetId}|${price.day}`; priceCounts.set(key, (priceCounts.get(key) ?? 0) + 1); }
  const balances = new Map<string, { raw: bigint; decimals: number; accountId: AccountId; assetId: AssetId }>();
  const snapshots = new Map<string, Array<{ raw: bigint; decimals: number; accountId: AccountId; assetId: AssetId }>>();
  const coverage: DayCoverage[] = [];
  let protocolSeen = false;
  let index = 0;
  const sortedEvents = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sourceId.localeCompare(b.sourceId) || a.sourceEventId.localeCompare(b.sourceEventId));
  for (const day of days) {
    const dayEvents: HistoricalEvent[] = [];
    while (index < sortedEvents.length && sortedEvents[index].occurredAt.slice(0, 10) === day) {
      const event = sortedEvents[index++]; dayEvents.push(event);
      const role = evidenceRole(event);
      if (role === "protocol_activity") { protocolSeen = true; continue; }
      if (role === "position_receipt") continue;
      const key = `${event.accountId}|${event.assetId}`;
      const prior = balances.get(key);
      if (prior && prior.decimals !== event.decimals) throw new PortfolioMaterializeError("incomplete_event", "Token decimals changed in historical effects.");
      balances.set(key, { raw: (prior?.raw ?? 0n) + BigInt(event.rawDelta), decimals: event.decimals, accountId: event.accountId, assetId: event.assetId });
    }
    let missingPrice = [...balances.values()].some((balance) => balance.raw !== 0n && priceCounts.get(`${balance.assetId}|${day}`) !== 1);
    if (dayEvents.some((event) => (event.kind === "contribution" || event.kind === "withdrawal") && priceCounts.get(`${event.assetId}|${day}`) !== 1)) missingPrice = true;
    for (const accountId of accounts) for (const sourceId of REQUIRED_SOURCES) coverage.push({ day, accountId,
      sourceId, ingestionVersion: checkpointMap.get(`${accountId}|${sourceId}`)!.ingestion_version,
      eventStatus: protocolSeen && sourceId === "aave:v3:8453" ? "partial" : "complete", priceStatus: missingPrice ? "partial" : "complete",
      reason: protocolSeen && sourceId === "aave:v3:8453" ? "protocol_position_history_unavailable" : missingPrice ? "missing_price" : null });
    if (recent.includes(day)) snapshots.set(day, [...balances.values()].filter((balance) => balance.raw !== 0n));
  }
  if (index !== sortedEvents.length) throw new PortfolioMaterializeError("incomplete_event", "Historical event falls outside replay days.");
  const inputDigest = await digest({ calculationRuleVersion: CALCULATION_RULE_VERSION, accounts, through,
    checkpoints: accounts.flatMap((account) => REQUIRED_SOURCES.map((sourceId) => checkpointMap.get(`${account}|${sourceId}`))),
    events: rawEvents, prices: validPrices.map((price) => ({ assetId: price.assetId, day: price.day, usd: price.usd,
      sourceId: price.sourceId, methodology: price.methodology, version: price.version })) });
  if (marker?.input_digest === inputDigest && !rebuildHold) {
    const existing = await db.prepare(`SELECT COUNT(*) AS count FROM portfolio_daily_results
      WHERE subject_reference = ? AND calculation_version = ? AND day BETWEEN ? AND ?`)
      .bind(subjectReference, marker.calculation_version, recent[0], recent.at(-1)).first<{ count: number }>();
    if (existing?.count === recent.length)
      return { status: "unchanged", calculationVersion: marker.calculation_version, inputDigest, days: recent.length, returnWindow: RETURN_WINDOW };
  }
  const calculationVersion = (marker?.calculation_version ?? 0) + 1;
  const calculation = calculatePortfolioDays({ events, prices: validPrices, coverage, calculationVersion });
  const recentPoints = calculation.points.filter((point) => recent.includes(point.day));
  if (recentPoints.length !== recent.length) throw new PortfolioMaterializeError("incomplete_event", "Daily calculation omitted a requested day.");
  const statements: D1PreparedStatement[] = [];
  for (const price of validPrices) statements.push(db.prepare(`INSERT INTO portfolio_price_observations
    (asset_id, day, source_id, version, usd, methodology, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, day, source_id, version) DO NOTHING`)
    .bind(price.assetId, price.day, price.sourceId, price.version, price.usd, price.methodology, price.observedAt));
  for (const point of recentPoints) {
    const dailyCoverage = coverage.filter((row) => row.day === point.day);
    statements.push(db.prepare(`INSERT INTO portfolio_daily_results
      (subject_reference, day, calculation_version, net_value_usd, twr_index, coverage_status, coverage_json, calculated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(subjectReference, point.day, calculationVersion, point.netValueUsd, point.twrIndex, point.status, JSON.stringify(dailyCoverage), now.toISOString()));
    if (point.status !== "complete") continue;
    for (const balance of snapshots.get(point.day) ?? []) statements.push(db.prepare(`INSERT INTO portfolio_daily_quantities
      (subject_reference, account_id, asset_id, day, calculation_version, raw_closing_quantity, decimals, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'complete')`)
      .bind(subjectReference, balance.accountId, balance.assetId, point.day, calculationVersion, balance.raw.toString(), balance.decimals));
  }
  for (const lot of calculation.lots) statements.push(db.prepare(`INSERT INTO portfolio_lots
    (subject_reference, account_id, asset_id, source_event_id, calculation_version, acquired_at, raw_acquired, raw_remaining, basis_usd, classification, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(subjectReference, lot.accountId, lot.assetId, lot.sourceEventId, calculationVersion, lot.acquiredAt, lot.rawAcquired, lot.rawRemaining, lot.basisUsd, lot.classification, lot.evidenceJson));
  for (const item of calculation.disposals) statements.push(db.prepare(`INSERT INTO portfolio_disposals
    (subject_reference, account_id, asset_id, source_event_id, leg_index, calculation_version, disposed_at, raw_units, proceeds_usd, basis_usd, gain_usd, classification, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(subjectReference, item.accountId, item.assetId, item.sourceEventId, item.legIndex, calculationVersion, item.disposedAt, item.rawUnits, item.proceedsUsd, item.basisUsd, item.gainUsd, item.classification, item.evidenceJson));
  if (rebuildHold) statements.push(db.prepare("DELETE FROM portfolio_rebuild_holds WHERE subject_reference = ? AND rebuild_id = ?")
    .bind(subjectReference, rebuildHold.rebuild_id));
  statements.push(db.prepare(`INSERT INTO portfolio_publications
    (subject_reference, input_digest, calculation_version, day_from, day_through, status, published_at)
    VALUES (?, ?, ?, ?, ?, 'published', ?)
    ON CONFLICT(subject_reference) DO UPDATE SET input_digest = excluded.input_digest, calculation_version = excluded.calculation_version,
      day_from = excluded.day_from, day_through = excluded.day_through, published_at = excluded.published_at,
      status = CASE WHEN portfolio_publications.input_digest IS ? AND portfolio_publications.calculation_version IS ? THEN 'published' ELSE 'conflict' END`)
    .bind(subjectReference, inputDigest, calculationVersion, recent[0], recent.at(-1), now.toISOString(), marker?.input_digest ?? null, marker?.calculation_version ?? null));
  if (statements.length > MAX_STATEMENTS) throw new PortfolioMaterializeError("workload_exceeded", "Derived publication exceeds the atomic batch bound.");
  try { await db.batch(statements); }
  catch { throw new PortfolioMaterializeError("conflict", "Portfolio publication changed concurrently or could not commit atomically."); }
  return { status: "published", calculationVersion, inputDigest, days: recent.length, returnWindow: RETURN_WINDOW };
}
