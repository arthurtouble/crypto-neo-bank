"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { PortfolioHistory } from "@/lib/portfolio/types";

type Range = "7D" | "1M" | "3M" | "1Y";
const ranges: Range[] = ["7D", "1M", "3M", "1Y"];
export function nextPortfolioRange(current: Range, key: "ArrowRight" | "ArrowLeft"): Range {
  const index = ranges.indexOf(current);
  return ranges[(index + (key === "ArrowRight" ? 1 : ranges.length - 1)) % ranges.length];
}
const DAY_MS = 86_400_000;
const CHART_WIDTH = 720;
const CHART_HEIGHT = 190;

type CompletePoint = { day: string; valueUsd: number; x: number; y: number };
type Gap = { day: string; reasons: string[]; x: number };
type ChartRun = { linePath: string; areaPath: string; points: CompletePoint[] };
export type PortfolioChartModel = {
  runs: ChartRun[];
  gaps: Gap[];
  displayValue: number | null;
  latestComplete: { day: string; valueUsd: number } | null;
  returnPercent: number | null;
  firstDay: string | null;
  lastDay: string | null;
  completeDays: number;
};

function dayNumber(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const millis = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === day ? millis : null;
}

function decimal(value: string | null): number | null {
  if (value === null || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && Math.abs(numeric) <= Number.MAX_SAFE_INTEGER ? numeric : null;
}

function currency(value: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function dateLabel(day: string) {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** A null, partial, invalid, or omitted day breaks both the line and its fill. */
export function buildPortfolioChartModel(history: PortfolioHistory): PortfolioChartModel {
  const pointByDay = new Map<string, PortfolioHistory["points"][number]>();
  const duplicates = new Set<string>();
  for (const point of history.points) {
    if (dayNumber(point.day) === null) continue;
    if (pointByDay.has(point.day)) duplicates.add(point.day);
    pointByDay.set(point.day, point);
  }
  const pointDays = [...pointByDay.keys()].sort();
  const observedDay = history.observedAt.slice(0, 10);
  const first = pointDays[0] ? dayNumber(pointDays[0]) : null;
  const latestPointDay = pointDays.at(-1);
  const endCandidate = dayNumber(observedDay);
  const last = latestPointDay ? Math.max(dayNumber(latestPointDay)!, endCandidate ?? 0) : null;
  if (first === null || last === null || last < first || (last - first) / DAY_MS > 366) {
    return { runs: [], gaps: [], displayValue: null, latestComplete: null, returnPercent: null, firstDay: null, lastDay: null, completeDays: 0 };
  }
  const days: Array<{ day: string; valueUsd: number | null; twrIndex: number | null; reasons: string[] }> = [];
  for (let millis = first; millis <= last; millis += DAY_MS) {
    const day = new Date(millis).toISOString().slice(0, 10);
    const point = pointByDay.get(day);
    const coverageReasons = history.coverage.filter((item) => item.day === day && (item.eventStatus !== "complete" || item.priceStatus !== "complete"))
      .map((item) => item.reason ?? `${item.sourceId}: ${item.eventStatus !== "complete" ? "source " + item.eventStatus : "price " + item.priceStatus}`);
    const valueUsd = point?.status === "complete" && !duplicates.has(day) && coverageReasons.length === 0 ? decimal(point.netValueUsd) : null;
    const twrIndex = point?.status === "complete" && !duplicates.has(day) && coverageReasons.length === 0 ? decimal(point.twrIndex) : null;
    const reasons = valueUsd === null
      ? [...new Set([...(point?.reasons ?? []), ...coverageReasons, ...(duplicates.has(day) ? ["Duplicate daily result"] : []), ...(!point ? ["No complete source history for this day"] : []), ...(point?.status === "complete" && decimal(point.netValueUsd) === null ? ["Value unavailable"] : [])])]
      : [];
    days.push({ day, valueUsd, twrIndex, reasons: reasons.length ? reasons : valueUsd === null ? ["Source or price evidence incomplete"] : [] });
  }
  const valid = days.filter((point): point is typeof point & { valueUsd: number } => point.valueUsd !== null);
  const min = Math.min(...valid.map((point) => point.valueUsd));
  const max = Math.max(...valid.map((point) => point.valueUsd));
  const spread = max - min || 1;
  const x = (index: number) => days.length === 1 ? CHART_WIDTH / 2 : index / (days.length - 1) * CHART_WIDTH;
  const y = (value: number) => CHART_HEIGHT - ((value - min) / spread) * (CHART_HEIGHT - 16) - 8;
  const gaps: Gap[] = [];
  const completeRuns: CompletePoint[][] = [];
  let current: CompletePoint[] = [];
  for (const [index, point] of days.entries()) {
    if (point.valueUsd === null) {
      if (current.length) completeRuns.push(current);
      current = [];
      gaps.push({ day: point.day, reasons: point.reasons, x: x(index) });
    } else current.push({ day: point.day, valueUsd: point.valueUsd, x: x(index), y: y(point.valueUsd) });
  }
  if (current.length) completeRuns.push(current);
  const runs = completeRuns.map((points) => {
    const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ") + (points.length === 1 ? ` L${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}` : "");
    const areaPath = points.length > 1 ? `${linePath} L${points.at(-1)!.x.toFixed(2)},200 L${points[0].x.toFixed(2)},200 Z` : "";
    return { linePath, areaPath, points };
  });
  const latestComplete = valid.at(-1);
  const allComplete = days.length > 1 && gaps.length === 0 && days.every((point) => point.twrIndex !== null && point.twrIndex > 0);
  const firstIndex = days[0]?.twrIndex;
  const lastIndex = days.at(-1)?.twrIndex;
  const calculatedReturn = allComplete && firstIndex && lastIndex ? (lastIndex / firstIndex - 1) * 100 : null;
  return {
    runs, gaps,
    displayValue: days.at(-1)?.valueUsd ?? null,
    latestComplete: latestComplete ? { day: latestComplete.day, valueUsd: latestComplete.valueUsd } : null,
    returnPercent: calculatedReturn !== null && Number.isFinite(calculatedReturn) ? calculatedReturn : null,
    firstDay: days[0]?.day ?? null, lastDay: days.at(-1)?.day ?? null,
    completeDays: valid.length
  };
}

export function PortfolioPerformance() {
  const { user, getAccessToken } = usePrivy();
  const [range, setRange] = useState<Range>("1M");
  const gradientId = useId().replaceAll(":", "");
  const history = useQuery<PortfolioHistory>({
    queryKey: ["portfolio-history", user?.id, range],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to view verified history.");
      const response = await fetch(`/api/portfolio/history?range=${range}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Verified history is unavailable.");
      return response.json() as Promise<PortfolioHistory>;
    },
    enabled: Boolean(user?.id), staleTime: 0
  });
  const model = useMemo(() => history.data ? buildPortfolioChartModel(history.data) : null, [history.data]);
  const aave = history.data?.currentAave;
  const aaveValue = (value: string | null | undefined) => aave?.status === "complete" && decimal(value ?? null) !== null ? currency(decimal(value!)!) : "unavailable";
  const externalCount = history.data?.externalWallets.length ?? 0;

  return <section className="panel portfolioPerformance" aria-label="Verified portfolio history">
    <div className="portfolioChartHeader"><div><span>Historical portfolio value</span><strong className="sensitiveAmount">{model?.displayValue === null || model === null ? "Unavailable" : currency(model.displayValue)}</strong><small>{model?.displayValue !== null && model?.lastDay ? `Complete through ${dateLabel(model.lastDay)}` : "Current day is incomplete or unavailable"}</small><small>{model?.returnPercent === null || model === null ? "Return unavailable" : `${model.returnPercent >= 0 ? "+" : ""}${model.returnPercent.toFixed(2)}% time-weighted return for ${range}`}</small></div>
      <div className="chartRanges" role="group" aria-label="Portfolio history range">{ranges.map((item) => <button key={item} type="button" className={range === item ? "active" : ""} aria-pressed={range === item} onClick={() => setRange(item)} onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); const next = nextPortfolioRange(item, event.key); setRange(next); event.currentTarget.parentElement?.querySelectorAll("button")?.[ranges.indexOf(next)]?.focus(); } }}>{item}</button>)}</div>
    </div>
    <div className="portfolioChart">
      {!user ? <div className="chartState">Sign in to view verified history.</div> : history.isPending ? <div className="chartState"><LoaderCircle className="spin" size={18} /> Loading verified history</div> : history.error ? <div className="chartState">Verified history is temporarily unavailable.</div> : !model?.runs.length ? <div className="chartState">No complete historical value is available for this range.</div> : <svg viewBox="0 0 720 200" role="img" aria-label={`${model.completeDays} complete days and ${model.gaps.length} coverage gaps for ${range}`} preserveAspectRatio="none"><defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".22"/><stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs>{model.runs.map((run, index) => <g key={index}>{run.areaPath && <path className="chartArea" d={run.areaPath} fill={`url(#${gradientId})`} />}<path className="chartLine" d={run.linePath} />{run.points.length === 1 && <circle className="chartPoint" cx={run.points[0].x} cy={run.points[0].y} r="3" />}</g>)}{model.gaps.map((gap) => <line className="chartGapMarker" key={gap.day} x1={gap.x} x2={gap.x} y1="4" y2="194" />)}</svg>}
    </div>
    <div className="chartFoot"><span>{model?.firstDay ? dateLabel(model.firstDay) : ""}</span><small>{model?.latestComplete ? `Last complete: ${currency(model.latestComplete.valueUsd)} on ${dateLabel(model.latestComplete.day)}` : "No complete days"}</small><span>{model?.lastDay ? dateLabel(model.lastDay) : ""}</span></div>
    <div className="portfolioCoverage"><p>{model ? `${model.completeDays} complete day${model.completeDays === 1 ? "" : "s"}; ${model.gaps.length} gap${model.gaps.length === 1 ? "" : "s"}.` : "Coverage pending."} Historical scope: Aurel wallet and {externalCount} linked external wallet{externalCount === 1 ? "" : "s"}.</p>{model && model.gaps.length > 0 && <ul aria-label="Missing portfolio history days">{model.gaps.map((gap) => <li key={gap.day}><strong>{dateLabel(gap.day)}</strong>: {gap.reasons.join("; ")}</li>)}</ul>}</div>
    <div className="portfolioAave" aria-label="Current Aave positions"><span>Aave supply <strong className="sensitiveAmount">{aaveValue(aave?.suppliedUsd)}</strong></span><span>Aave debt <strong className="sensitiveAmount">{aaveValue(aave?.debtUsd)}</strong></span><small>Current protocol positions are shown separately and are not added again to the historical chart.</small></div>
  </section>;
}
