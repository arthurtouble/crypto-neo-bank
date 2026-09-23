import type { AccountId, Completeness, HistoricalEvent, HistoricalEventSource } from "@/lib/portfolio/types";
import { invalidateFromBlock } from "@/lib/portfolio/store";

const FIRST_DAY = "2023-01-01T00:00:00.000Z";
const MAX_EVENTS = 100;
const PAGE_LIMIT = 25;
type Checkpoint = { cursor: string | null; covered_from: string | null; covered_through: string | null; status: Completeness };
type Resume = { token: string; sourceCursor: string; from: string; through: string };

export class PortfolioIngestError extends Error {
  constructor(readonly code: "invalid_cursor" | "source_unavailable" | "incomplete_page" | "conflict" | "reorg", message: string) { super(message); this.name = "PortfolioIngestError"; }
}

function decodeResume(cursor: string): Resume | null {
  try {
    const value = JSON.parse(atob(cursor)) as Partial<Resume>;
    return typeof value.token === "string" && /^[0-9a-f-]{36}$/.test(value.token) && typeof value.sourceCursor === "string" && value.sourceCursor.length > 0 && value.sourceCursor.length <= 16_000 && typeof value.from === "string" && typeof value.through === "string" ? value as Resume : null;
  } catch { return null; }
}

function validateEvent(event: HistoricalEvent, accountId: AccountId, sourceId: string, from: string, through: string): boolean {
  return event.accountId === accountId && event.sourceId === sourceId && event.chainId === 8453 && event.assetId.startsWith("8453:")
    && /^-?(0|[1-9]\d*)$/.test(event.rawDelta) && event.rawDelta !== "-0" && Number.isInteger(event.decimals) && event.decimals >= 0 && event.decimals <= 36
    && typeof event.sourceEventId === "string" && event.sourceEventId.length > 0 && event.sourceEventId.length <= 240
    && event.occurredAt >= from && event.occurredAt < through && /^\d+$/.test(event.blockNumber ?? "")
    && /^0x[a-f0-9]{64}$/i.test(event.blockHash ?? "") && /^0x[a-f0-9]{64}$/i.test(event.txHash ?? "")
    && event.finality === "finalized" && event.completeness === "complete" && event.evidenceJson.length <= 16_000;
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ingestOnePage(
  db: D1Database, subjectReference: string, accountId: AccountId, source: HistoricalEventSource, cursor: string | null,
  options: { now?: Date } = {}
): Promise<{ nextCursor: string | null; status: Completeness; coveredThrough: string | null }> {
  if (!subjectReference || !/^8453:0x[a-f0-9]{40}$/.test(accountId) || !source.sourceId) throw new PortfolioIngestError("invalid_cursor", "Invalid account or source.");
  const checkpoint = await db.prepare(`SELECT cursor, covered_from, covered_through, status FROM portfolio_source_checkpoints
    WHERE subject_reference = ? AND account_id = ? AND source_id = ?`).bind(subjectReference, accountId, source.sourceId).first<Checkpoint>();
  if (cursor !== checkpoint?.cursor && !(cursor === null && !checkpoint)) throw new PortfolioIngestError("invalid_cursor", "Resume token does not match the current checkpoint.");
  const resume = cursor ? decodeResume(cursor) : null;
  if (cursor && !resume) throw new PortfolioIngestError("invalid_cursor", "Malformed resume token.");
  const now = options.now ?? new Date();
  const from = resume?.from ?? checkpoint?.covered_through ?? FIRST_DAY;
  const through = resume?.through ?? new Date(now.getTime() - 5 * 60_000).toISOString();
  if (from >= through) return { nextCursor: null, status: checkpoint?.status ?? "partial", coveredThrough: checkpoint?.covered_through ?? null };
  let page;
  try { page = await source.page({ accountId, cursor: resume?.sourceCursor ?? null, from, through, limit: PAGE_LIMIT }); }
  catch { throw new PortfolioIngestError("source_unavailable", "Historical source is unavailable; prior coverage was preserved."); }
  const reportedReorg = page.events.find((item) => item.accountId === accountId && item.sourceId === source.sourceId && item.chainId === 8453 && item.finality === "reorged" && item.blockNumber && /^\d+$/.test(item.blockNumber));
  if (reportedReorg) {
    const prior = await db.prepare(`SELECT block_number FROM portfolio_events WHERE subject_reference = ? AND source_id = ? AND source_event_id = ? AND ingestion_version = ? AND leg_index = 0`)
      .bind(subjectReference, source.sourceId, reportedReorg.sourceEventId, reportedReorg.ingestionVersion).first<{ block_number: string | null }>();
    const earliest = prior?.block_number && /^\d+$/.test(prior.block_number) && BigInt(prior.block_number) < BigInt(reportedReorg.blockNumber!) ? prior.block_number : reportedReorg.blockNumber!;
    await invalidateFromBlock(db, subjectReference, 8453, earliest);
    throw new PortfolioIngestError("reorg", "The source reported a changed canonical block; derived coverage was invalidated.");
  }
  if (page.sourceId !== source.sourceId || page.events.length > MAX_EVENTS || (page.nextCursor !== null && page.nextCursor.length > 16_000) || page.nextCursor === resume?.sourceCursor || (page.complete && (page.nextCursor !== null || page.coveredThrough !== through)) || (!page.complete && !page.nextCursor)) throw new PortfolioIngestError("incomplete_page", "Historical page has no continuous, trustworthy continuation.");
  const identities = new Set<string>();
  for (const event of page.events) {
    const key = `${event.sourceEventId}:${event.ingestionVersion}`;
    if (!validateEvent(event, accountId, source.sourceId, from, through) || identities.has(key)) throw new PortfolioIngestError("incomplete_page", "Historical page contains malformed or duplicate evidence.");
    identities.add(key);
    try { JSON.parse(event.evidenceJson); } catch { throw new PortfolioIngestError("incomplete_page", "Historical event evidence is invalid."); }
    const prior = await db.prepare(`SELECT block_hash, block_number, finality FROM portfolio_events WHERE subject_reference = ? AND source_id = ? AND source_event_id = ? AND ingestion_version = ? AND leg_index = 0`)
      .bind(subjectReference, source.sourceId, event.sourceEventId, event.ingestionVersion).first<{ block_hash: string | null; block_number: string | null; finality: string }>();
    if (prior?.block_hash && prior.finality !== "reorged" && prior.block_hash.toLowerCase() !== event.blockHash?.toLowerCase()) {
      const earliest = prior.block_number && /^\d+$/.test(prior.block_number) && BigInt(prior.block_number) < BigInt(event.blockNumber!) ? prior.block_number : event.blockNumber!;
      await invalidateFromBlock(db, subjectReference, 8453, earliest);
      throw new PortfolioIngestError("reorg", "A canonical block changed; derived coverage was invalidated.");
    }
  }
  const nextCursor = page.complete ? null : btoa(JSON.stringify({ token: crypto.randomUUID(), sourceCursor: page.nextCursor!, from, through } satisfies Resume));
  const coveredThrough = page.complete ? through : checkpoint?.covered_through ?? null;
  const finalized = page.events.reduce<HistoricalEvent | null>((latest, item) => !latest || BigInt(item.blockNumber!) > BigInt(latest.blockNumber!) ? item : latest, null);
  const statements = await Promise.all(page.events.map(async (event) => db.prepare(`INSERT INTO portfolio_events
    (subject_reference, source_id, source_event_id, ingestion_version, leg_index, account_id, asset_id, raw_delta, decimals, event_kind, occurred_at, chain_id, block_number, block_hash, tx_hash, log_index, finality, completeness, group_id, counterparty_account_id, evidence_hash, evidence_json, observed_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(subject_reference, source_id, source_event_id, ingestion_version, leg_index) DO UPDATE SET
      account_id = excluded.account_id, asset_id = excluded.asset_id, raw_delta = excluded.raw_delta,
      decimals = excluded.decimals, event_kind = excluded.event_kind, occurred_at = excluded.occurred_at,
      chain_id = excluded.chain_id, block_number = excluded.block_number, block_hash = excluded.block_hash,
      tx_hash = excluded.tx_hash, log_index = excluded.log_index, finality = excluded.finality,
      completeness = excluded.completeness, group_id = excluded.group_id, counterparty_account_id = excluded.counterparty_account_id,
      evidence_hash = excluded.evidence_hash, evidence_json = excluded.evidence_json, observed_at = excluded.observed_at
      WHERE portfolio_events.finality = 'reorged'`)
    .bind(subjectReference, source.sourceId, event.sourceEventId, event.ingestionVersion, accountId, event.assetId, event.rawDelta, event.decimals, event.kind, event.occurredAt, event.chainId, event.blockNumber, event.blockHash, event.txHash, event.logIndex, event.finality, event.completeness, event.groupId, event.counterpartyAccountId, await sha256(event.evidenceJson), event.evidenceJson, now.toISOString())));
  statements.push(db.prepare(`INSERT INTO portfolio_source_checkpoints
    (subject_reference, account_id, source_id, cursor, covered_from, covered_through, last_finalized_block, last_finalized_hash, ingestion_version, status, reason, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?)
    ON CONFLICT(subject_reference, account_id, source_id) DO UPDATE SET
      cursor = excluded.cursor, covered_from = excluded.covered_from, covered_through = excluded.covered_through,
      last_finalized_block = COALESCE(excluded.last_finalized_block, portfolio_source_checkpoints.last_finalized_block),
      last_finalized_hash = COALESCE(excluded.last_finalized_hash, portfolio_source_checkpoints.last_finalized_hash),
      -- Checkpoint version is a page revision for publication freshness;
      -- event ingestion_version is the provider's own evidence version.
      ingestion_version = portfolio_source_checkpoints.ingestion_version + 1,
      status = CASE WHEN portfolio_source_checkpoints.cursor IS ? AND portfolio_source_checkpoints.covered_through IS ?
        THEN excluded.status ELSE 'conflict' END, reason = NULL, updated_at = excluded.updated_at`)
    .bind(subjectReference, accountId, source.sourceId, nextCursor, from, coveredThrough, finalized?.blockNumber ?? null, finalized?.blockHash ?? null, page.complete ? "complete" : "partial", now.toISOString(), checkpoint?.cursor ?? null, checkpoint?.covered_through ?? null));
  try { await db.batch(statements); }
  catch { throw new PortfolioIngestError("conflict", "Historical checkpoint changed or the database could not commit this page."); }
  return { nextCursor, status: page.complete ? "complete" : "partial", coveredThrough };
}
