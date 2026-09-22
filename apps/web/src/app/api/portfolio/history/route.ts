import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { RateLimitError, enforceRateLimit } from "@/lib/security/rate-limit";
import { resolvePortfolioAccounts } from "@/lib/portfolio/accounts";
import { readCurrentAaveLegs } from "@/lib/portfolio/aave-source";
import type { AccountId, Completeness, DayCoverage, HistoryPoint, PortfolioHistory } from "@/lib/portfolio/types";

const RANGE_DAYS = { "7D": 7, "1M": 30, "3M": 90, "1Y": 365 } as const;
const REQUIRED_SOURCES = ["blockscout:8453", "aave:v3:8453"] as const;
type DailyRow = { day: string; calculation_version: number; net_value_usd: string | null; twr_index: string | null; coverage_status: Completeness; coverage_json: string };
type Checkpoint = { account_id: string; source_id: string; covered_from: string | null; covered_through: string | null; status: Completeness; ingestion_version: number };
type Nonfinal = { account_id: string; source_id: string; day: string };

function response(body: Record<string, unknown>, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function validCoverage(value: unknown, day: string, accounts: Set<string>): DayCoverage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DayCoverage => Boolean(item && typeof item === "object" && item.day === day && accounts.has(item.accountId)
    && typeof item.sourceId === "string" && ["complete", "partial", "unavailable", "unfinalized"].includes(item.eventStatus)
    && ["complete", "partial", "unavailable", "unfinalized"].includes(item.priceStatus) && (item.reason === null || typeof item.reason === "string")));
}
function dayRange(count: number): string[] {
  const today = new Date();
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: count }, (_, index) => new Date(midnight - (count - index) * 86_400_000).toISOString().slice(0, 10));
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "portfolio-history", subject: subject.subjectReference, limit: 60, windowSeconds: 60 });
    const url = new URL(request.url);
    const range = url.searchParams.get("range") ?? "7D";
    if (!(range in RANGE_DAYS) || [...url.searchParams.keys()].some((key) => key !== "range")) return response({ error: "invalid_range", traceId }, 400);
    const days = dayRange(RANGE_DAYS[range as keyof typeof RANGE_DAYS]);
    const accounts = await resolvePortfolioAccounts(subject.subjectReference);
    const allowed = new Set<string>(accounts.map((item) => item.accountId));
    const publication = await env.PROJECTION_DB.prepare("SELECT calculation_version FROM portfolio_publications WHERE subject_reference = ? AND status = 'published'")
      .bind(subject.subjectReference).first<{ calculation_version: number }>();
    const calculationVersion = publication?.calculation_version ?? 0;
    const [daily, checkpoints, nonfinal] = await Promise.all([
      calculationVersion ? env.PROJECTION_DB.prepare(`SELECT day, calculation_version, net_value_usd, twr_index, coverage_status, coverage_json
        FROM portfolio_daily_results WHERE subject_reference = ? AND calculation_version = ? AND day BETWEEN ? AND ? ORDER BY day ASC LIMIT 365`)
        .bind(subject.subjectReference, calculationVersion, days[0], days.at(-1)).all<DailyRow>().then((result) => result.results) : Promise.resolve([] as DailyRow[]),
      env.PROJECTION_DB.prepare(`SELECT account_id, source_id, covered_from, covered_through, status, ingestion_version
        FROM portfolio_source_checkpoints WHERE subject_reference = ?`).bind(subject.subjectReference).all<Checkpoint>().then((result) => result.results),
      env.PROJECTION_DB.prepare(`SELECT account_id, source_id, substr(occurred_at, 1, 10) AS day FROM portfolio_events
        WHERE subject_reference = ? AND occurred_at >= ? AND occurred_at < ? AND (finality != 'finalized' OR completeness != 'complete')
        GROUP BY account_id, source_id, substr(occurred_at, 1, 10) LIMIT 1001`)
        .bind(subject.subjectReference, `${days[0]}T00:00:00Z`, `${new Date(Date.parse(`${days.at(-1)}T00:00:00Z`) + 86_400_000).toISOString()}`).all<Nonfinal>().then((result) => result.results)
    ]);
    const byDay = new Map(daily.map((item) => [item.day, item]));
    const byCheckpoint = new Map(checkpoints.filter((item) => allowed.has(item.account_id)).map((item) => [`${item.account_id}|${item.source_id}`, item]));
    const finalityScanIncomplete = nonfinal.length > 1000;
    const pending = new Set(nonfinal.filter((item) => allowed.has(item.account_id)).map((item) => `${item.day}|${item.account_id}`));
    const coverage: DayCoverage[] = [];
    const points: HistoryPoint[] = days.map((day) => {
      const row = byDay.get(day);
      let rows: DayCoverage[] = [];
      let foreignCoverage = false;
      let malformedCoverage = false;
      try {
        const raw = JSON.parse(row?.coverage_json ?? "null") as unknown;
        foreignCoverage = Array.isArray(raw) && raw.some((item) => item && typeof item === "object" && "accountId" in item && !allowed.has(String(item.accountId)));
        rows = validCoverage(raw, day, allowed);
        malformedCoverage = !Array.isArray(raw) || raw.length !== rows.length + (foreignCoverage ? raw.filter((item) => item && typeof item === "object" && "accountId" in item && !allowed.has(String(item.accountId))).length : 0);
      } catch { malformedCoverage = true; }
      coverage.push(...rows);
      const reasons = new Set<string>(row ? [] : ["missing_daily_result"]);
      if (foreignCoverage) reasons.add("account_scope_changed");
      if (malformedCoverage) reasons.add("malformed_source_coverage");
      if (finalityScanIncomplete) reasons.add("finality_scan_incomplete");
      if (accounts.some((account) => pending.has(`${day}|${account.accountId}`))) reasons.add("unfinalized_event");
      if (!allowed.size) reasons.add("missing_linked_account");
      for (const account of accounts) for (const sourceId of REQUIRED_SOURCES) {
        const matching = rows.filter((item) => item.accountId === account.accountId && item.sourceId === sourceId);
        const evidence = matching[0];
        if (matching.length > 1) reasons.add("conflicting_source_coverage");
        const checkpoint = byCheckpoint.get(`${account.accountId}|${sourceId}`);
        const dayEnd = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString();
        if (!evidence || !checkpoint || !checkpoint.covered_from || checkpoint.covered_from > `${day}T00:00:00Z` || !checkpoint.covered_through || checkpoint.covered_through < dayEnd) reasons.add("missing_source_coverage");
        if (evidence?.eventStatus !== "complete") reasons.add(evidence?.reason ?? "incomplete_source");
        if (evidence?.priceStatus !== "complete") reasons.add(evidence?.reason ?? "incomplete_price_source");
      }
      if (row?.coverage_status !== "complete") reasons.add(row?.coverage_status === "unfinalized" ? "unfinalized_calculation" : "incomplete_calculation");
      if (row?.net_value_usd === null || row?.net_value_usd === undefined) reasons.add("missing_value");
      return reasons.size ? { day, netValueUsd: null, twrIndex: null, status: "partial", reasons: [...reasons] }
        : { day, netValueUsd: row!.net_value_usd, twrIndex: row!.twr_index, status: "complete", reasons: [] };
    });
    const aave = await Promise.all(accounts.map(async (account) => {
      try { return { accountId: account.accountId, ...await readCurrentAaveLegs(account.accountId) }; }
      catch { return { accountId: account.accountId, legs: [], status: "unavailable" as Completeness, reason: "aave_unavailable" }; }
    }));
    const aaveStatus: Completeness = !accounts.length || aave.some((item) => item.status === "unavailable") ? "unavailable" : aave.some((item) => item.status !== "complete" || item.legs.length > 0) ? "partial" : "complete";
    const history: PortfolioHistory = { calculationVersion, points, coverage, externalWallets: accounts.filter((item) => item.origin === "linked_external").map((item) => item.accountId),
      currentAave: { suppliedUsd: aaveStatus === "complete" ? "0" : null, debtUsd: aaveStatus === "complete" ? "0" : null, status: aaveStatus }, observedAt: new Date().toISOString() };
    return response({ ...history, returnWindow: { pricedDays: 7, scope: "recent_completed_utc_days", inceptionReturnAvailable: false }, sourceVersions: Object.fromEntries([...byCheckpoint].map(([key, item]) => [key, item.ingestion_version])),
      currentAave: { ...history.currentAave, legs: aave.flatMap((item) => item.legs.map((leg) => ({ accountId: item.accountId as AccountId, ...leg }))), observedAt: new Date().toISOString(), reason: aaveStatus === "partial" ? "missing_current_price" : aaveStatus === "unavailable" ? "aave_unavailable" : null }, traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return response({ error: "unauthorized", traceId }, 401);
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", traceId }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } });
    console.error(JSON.stringify({ level: "error", event: "portfolio.history.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return response({ error: "history_unavailable", traceId }, 503);
  }
}
