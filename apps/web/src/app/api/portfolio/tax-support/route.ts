import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { RateLimitError, enforceRateLimit } from "@/lib/security/rate-limit";
import { resolvePortfolioAccounts } from "@/lib/portfolio/accounts";

const PAGE_SIZE = 50;
const REQUIRED_SOURCES = ["blockscout:8453", "aave:v3:8453"] as const;
type TaxRow = { kind: "lot" | "disposal"; account_id: string; asset_id: string; source_event_id: string; leg_index: number; occurred_at: string; calculation_version: number; raw_units: string; proceeds_usd: string | null; basis_usd: string | null; gain_usd: string | null; classification: "supported" | "review_required"; evidence_json: string };
type Checkpoint = { account_id: string; source_id: string; covered_from: string | null; covered_through: string | null; status: string; ingestion_version: number };
type PublishedCoverage = { accountId: string; sourceId: string; ingestionVersion?: number };
type Cursor = { year: number; version: number; offset: number };

function response(body: Record<string, unknown>, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function decodeCursor(value: string): Cursor | null {
  try { const data = JSON.parse(atob(value)) as Partial<Cursor>; return Number.isInteger(data.year) && Number.isInteger(data.version) && Number.isInteger(data.offset) && data.offset! >= 0 && data.offset! <= 100_000 ? data as Cursor : null; }
  catch { return null; }
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "portfolio-tax-support", subject: subject.subjectReference, limit: 30, windowSeconds: 60 });
    const url = new URL(request.url);
    const yearText = url.searchParams.get("year");
    const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : NaN;
    const cursorText = url.searchParams.get("cursor");
    const cursor = cursorText ? decodeCursor(cursorText) : null;
    if (!Number.isInteger(year) || year < 2023 || year > new Date().getUTCFullYear() || [...url.searchParams.keys()].some((key) => key !== "year" && key !== "cursor") || (cursorText && !cursor)) return response({ error: "invalid_tax_request", traceId }, 400);
    const accounts = await resolvePortfolioAccounts(subject.subjectReference);
    const allowed = new Set<string>(accounts.map((item) => item.accountId));
    const accountIds = [...allowed];
    const accountFilter = accountIds.map(() => "?").join(",");
    const from = new Date(Date.UTC(year, 0, 1)).toISOString();
    const through = new Date(Date.UTC(year + 1, 0, 1)).toISOString();
    const publication = await env.PROJECTION_DB.prepare(`SELECT calculation_version FROM portfolio_publications
      WHERE subject_reference = ? AND status = 'published'
        AND NOT EXISTS (SELECT 1 FROM portfolio_rebuild_holds h WHERE h.subject_reference = portfolio_publications.subject_reference)`)
      .bind(subject.subjectReference).first<{ calculation_version: number }>();
    const calculationVersion = accountIds.length ? publication?.calculation_version ?? 0 : 0;
    const published = calculationVersion ? await env.PROJECTION_DB.prepare(`SELECT coverage_json FROM portfolio_daily_results
      WHERE subject_reference = ? AND calculation_version = ? ORDER BY day DESC LIMIT 1`)
      .bind(subject.subjectReference, calculationVersion).first<{ coverage_json: string }>() : null;
    if (cursor && (cursor.year !== year || cursor.version !== calculationVersion)) return response({ error: "invalid_cursor", traceId }, 400);
    const offset = cursor?.offset ?? 0;
    const [result, count, checkpoints] = await Promise.all([
      calculationVersion ? env.PROJECTION_DB.prepare(`SELECT kind, account_id, asset_id, source_event_id, leg_index, occurred_at, calculation_version, raw_units, proceeds_usd, basis_usd, gain_usd, classification, evidence_json FROM (
        SELECT 'lot' AS kind, account_id, asset_id, source_event_id, 0 AS leg_index, acquired_at AS occurred_at, calculation_version, raw_acquired AS raw_units, NULL AS proceeds_usd, basis_usd, NULL AS gain_usd, classification, evidence_json FROM portfolio_lots WHERE subject_reference = ? AND calculation_version = ? AND acquired_at >= ? AND acquired_at < ? AND account_id IN (${accountFilter})
        UNION ALL
        SELECT 'disposal' AS kind, account_id, asset_id, source_event_id, leg_index, disposed_at AS occurred_at, calculation_version, raw_units, proceeds_usd, basis_usd, gain_usd, classification, evidence_json FROM portfolio_disposals WHERE subject_reference = ? AND calculation_version = ? AND disposed_at >= ? AND disposed_at < ? AND account_id IN (${accountFilter}))
        ORDER BY occurred_at, kind, account_id, asset_id, source_event_id, leg_index LIMIT ? OFFSET ?`)
        .bind(subject.subjectReference, calculationVersion, from, through, ...accountIds, subject.subjectReference, calculationVersion, from, through, ...accountIds, PAGE_SIZE + 1, offset).all<TaxRow>().then((value) => value.results) : Promise.resolve([] as TaxRow[]),
      calculationVersion ? env.PROJECTION_DB.prepare(`SELECT COUNT(*) AS count FROM (
        SELECT classification FROM portfolio_lots WHERE subject_reference = ? AND calculation_version = ? AND acquired_at >= ? AND acquired_at < ? AND account_id IN (${accountFilter})
        UNION ALL SELECT classification FROM portfolio_disposals WHERE subject_reference = ? AND calculation_version = ? AND disposed_at >= ? AND disposed_at < ? AND account_id IN (${accountFilter}))
        WHERE classification = 'review_required'`)
        .bind(subject.subjectReference, calculationVersion, from, through, ...accountIds, subject.subjectReference, calculationVersion, from, through, ...accountIds).first<{ count: number }>() : Promise.resolve({ count: 0 }),
      env.PROJECTION_DB.prepare(`SELECT account_id, source_id, covered_from, covered_through, status, ingestion_version
        FROM portfolio_source_checkpoints WHERE subject_reference = ?`).bind(subject.subjectReference).all<Checkpoint>().then((value) => value.results)
    ]);
    const checkpointMap = new Map(checkpoints.filter((item) => allowed.has(item.account_id)).map((item) => [`${item.account_id}|${item.source_id}`, item]));
    let publishedCoverage: PublishedCoverage[] = [];
    try {
      const parsed = JSON.parse(published?.coverage_json ?? "null") as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => item && typeof item === "object")) publishedCoverage = parsed as PublishedCoverage[];
    } catch { /* Missing or malformed publication is never tax authority. */ }
    const publicationFresh = calculationVersion > 0 && accounts.length > 0 && accounts.every((account) => REQUIRED_SOURCES.every((sourceId) => {
      const source = checkpointMap.get(`${account.accountId}|${sourceId}`);
      const matching = publishedCoverage.filter((item) => item.accountId === account.accountId && item.sourceId === sourceId);
      return source?.status === "complete" && matching.length === 1 && matching[0].ingestionVersion === source.ingestion_version;
    })) && publishedCoverage.length === accounts.length * REQUIRED_SOURCES.length;
    const sourceCoverage = accounts.flatMap((account) => REQUIRED_SOURCES.map((sourceId) => {
      const checkpoint = checkpointMap.get(`${account.accountId}|${sourceId}`);
      const coveredFrom = Date.parse(checkpoint?.covered_from ?? "");
      const coveredThrough = Date.parse(checkpoint?.covered_through ?? "");
      const status = publicationFresh && checkpoint?.status === "complete" && Number.isFinite(coveredFrom) && coveredFrom <= Date.parse(from)
        && Number.isFinite(coveredThrough) && coveredThrough >= Date.parse(through) ? "complete" : "partial";
      return { accountId: account.accountId, sourceId, status, coveredFrom: checkpoint?.covered_from ?? null, coveredThrough: checkpoint?.covered_through ?? null, ingestionVersion: checkpoint?.ingestion_version ?? null };
    }));
    const coverageStatus = accounts.length > 0 && sourceCoverage.every((item) => item.status === "complete") ? "complete" : "partial";
    const rows = (publicationFresh ? result : []).filter((row) => allowed.has(row.account_id)).slice(0, PAGE_SIZE).map((row) => {
      let evidence: unknown = null;
      try { evidence = JSON.parse(row.evidence_json); } catch { /* projection evidence is reported as unavailable */ }
      return { kind: row.kind, accountId: row.account_id, assetId: row.asset_id, sourceEventId: row.source_event_id, legIndex: row.leg_index,
        occurredAt: row.occurred_at, calculationVersion: row.calculation_version, rawUnits: row.raw_units, proceedsUsd: row.proceeds_usd,
        basisUsd: row.basis_usd, gainUsd: row.gain_usd, classification: row.classification, evidence };
    });
    const nextCursor = publicationFresh && result.length > PAGE_SIZE ? btoa(JSON.stringify({ year, version: calculationVersion, offset: offset + PAGE_SIZE } satisfies Cursor)) : null;
    return response({ year, calculationVersion, rows, nextCursor, reviewRequiredCount: publicationFresh ? count?.count ?? 0 : 0,
      coverage: { status: coverageStatus, sources: sourceCoverage }, notice: publicationFresh
        ? "Versioned tax support only; not tax advice. Incomplete source coverage may omit events."
        : "Tax support is unavailable until source history is republished; not tax advice.", traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return response({ error: "unauthorized", traceId }, 401);
    if (error instanceof BetaAccessError) return response({ error: error.code, traceId }, 403);
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", traceId }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } });
    console.error(JSON.stringify({ level: "error", event: "portfolio.tax-support.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return response({ error: "tax_support_unavailable", traceId }, 503);
  }
}
