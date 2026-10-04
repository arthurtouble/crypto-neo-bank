"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { formatUsd } from "@/lib/format";
import type { InsightBucket, InsightMerchant } from "@/lib/insights/presentation";
import { Notice } from "./states";

/** What GET /api/insights returns, and what the guest summary is built into. */
export type Summary = {
  periodDays: number;
  completedCount: number;
  totals: { incoming: number; outgoing: number; allocation: number; movement: number; unvalued: number };
  over: { unit: "day" | "week" | "month"; buckets: InsightBucket[] };
  topMerchants: InsightMerchant[];
  /** False when money received or card refunds couldn't all be read: money in is then unknown, not zero. */
  incomingComplete: boolean;
  /** False when card payments couldn't all be read: money out is then unknown. */
  outgoingComplete: boolean;
};

/** Which total the list is narrowed to: its transactions in the summary's period. */
export type SummaryTotal = "in" | "out" | "earn" | "moved";

export const PERIODS = [7, 30, 90, 365] as const;
export type Period = (typeof PERIODS)[number];
export const periodName = (days: number) => days === 365 ? "1 year" : `${days} days`;
export const totalName: Record<SummaryTotal, string> = { in: "Money in", out: "Money out", earn: "Added to Earn", moved: "Swapped" };

const whole = (value: number) => formatUsd(value, { whole: true });
const exact = (value: number) => formatUsd(value);
const CHART_KEY = "aura.transactions.chart";

function bucketLabel(start: string, unit: Summary["over"]["unit"], long = false) {
  const date = new Date(start);
  if (unit === "month") return date.toLocaleDateString(undefined, { month: long ? "long" : "short", year: long ? "numeric" : undefined, timeZone: "UTC" });
  const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  return unit === "week" && long ? `Week of ${day}` : day;
}

/** Money in and out per day, week, or month: two series side by side on one axis, with a hover readout and a table. */
function InOutChart({ data }: { data: Summary }) {
  const [active, setActive] = useState<number | null>(null);
  const series = [
    ...(data.incomingComplete ? [{ key: "incoming" as const, name: "Money in", className: "inSeriesIn" }] : []),
    ...(data.outgoingComplete ? [{ key: "outgoing" as const, name: "Money out", className: "inSeriesOut" }] : [])
  ];
  const buckets = data.over.buckets;
  const width = 640, height = 180, top = 10, bottom = 4, left = 4;
  const plot = height - top - bottom;
  const peak = Math.max(1, ...buckets.flatMap((bucket) => series.map((item) => bucket[item.key])));
  const slot = (width - left) / Math.max(buckets.length, 1);
  const barWidth = Math.max(3, Math.min(18, (slot - 6) / Math.max(series.length, 1) - 2));
  const labelEvery = Math.ceil(buckets.length / 7);
  const shown = active === null ? null : buckets[active];
  return <section className="inChart" aria-labelledby="in-out-heading">
    <div className="inChartHead"><h3 id="in-out-heading">Money in and out</h3>
      {series.length > 1 && <div className="chartLegend inLegend">{series.map((item) => <span key={item.key}><i className={item.className} />{item.name}</span>)}</div>}</div>
    {!series.length ? <Notice tone="warning">Money in and out can&apos;t all be read right now.</Notice> : <>
      {series.length < 2 && <p className="mxHint">{data.incomingComplete ? "Money out" : "Money in"} can&apos;t all be read right now, so only {series[0].name.toLowerCase()} is shown.</p>}
      <div className="inPlot" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.map((item) => item.name).join(" and ")} by ${data.over.unit}`} preserveAspectRatio="none">
          {/* The highlight goes under the bars, so it never hides them. */}
          {active !== null && <rect className="inActive" x={left + active * slot} y={top} width={slot} height={plot} />}
          <line className="inBaseline" x1={0} x2={width} y1={top + plot} y2={top + plot} />
          {buckets.map((bucket, index) => {
            const x = left + index * slot + (slot - series.length * (barWidth + 2)) / 2;
            return <g key={bucket.start} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)}>
              <rect className="chartHit inHit" x={left + index * slot} y={top} width={slot} height={plot} />
              {series.map((item, position) => {
                const value = bucket[item.key];
                const barHeight = value > 0 ? Math.max(2, (value / peak) * plot) : 0;
                return barHeight ? <path key={item.key} className={item.className} d={bar(x + position * (barWidth + 2), top + plot, barWidth, barHeight)} /> : null;
              })}
            </g>;
          })}
        </svg>
        {/* Labels sit outside the SVG, which stretches to the card's width, so the text isn't distorted. */}
        <div className="inTicks" aria-hidden="true">{buckets.map((bucket, index) => index % labelEvery === 0
          ? <span key={bucket.start} style={{ left: `${((left + index * slot + slot / 2) / width) * 100}%` }}>{bucketLabel(bucket.start, data.over.unit)}</span> : null)}</div>
        {shown && <div className="chartTooltip inTooltip" role="status" style={tooltipAt(active!, buckets.length)}>
          <strong>{bucketLabel(shown.start, data.over.unit, true)}</strong>
          {series.map((item) => <span key={item.key}><i className={item.className} />{item.name}<b>{exact(shown[item.key])}</b></span>)}
        </div>}
      </div>
      <details className="inTable"><summary>Show as a table</summary>
        <table><thead><tr><th scope="col">{data.over.unit === "month" ? "Month" : data.over.unit === "week" ? "Week of" : "Day"}</th>{series.map((item) => <th scope="col" key={item.key}>{item.name}</th>)}</tr></thead>
          <tbody>{buckets.map((bucket) => <tr key={bucket.start}><th scope="row">{bucketLabel(bucket.start, data.over.unit, true)}</th>
            {series.map((item) => <td key={item.key}>{exact(bucket[item.key])}</td>)}</tr>)}</tbody></table>
      </details>
    </>}
  </section>;
}

/** Beside the hovered group, on whichever side has room, so it never covers the bars or leaves the card. */
function tooltipAt(index: number, count: number) {
  const start = (index / count) * 100, end = ((index + 1) / count) * 100;
  return end <= 55 ? { left: `${end}%` } : { right: `${100 - start}%` };
}

/** A bar with a rounded top, anchored square to the baseline. */
function bar(x: number, baseline: number, width: number, height: number) {
  const radius = Math.min(4, width / 2, height);
  return `M${x},${baseline}V${baseline - height + radius}Q${x},${baseline - height} ${x + radius},${baseline - height}H${x + width - radius}Q${x + width},${baseline - height} ${x + width},${baseline - height + radius}V${baseline}Z`;
}

/** The card merchants paid most. Tapping one shows its payments in the list. */
function TopMerchants({ data, onMerchant }: { data: Summary; onMerchant: (name: string) => void }) {
  const peak = Math.max(...data.topMerchants.map((item) => item.total), 1);
  return <section aria-labelledby="merchants-heading"><h3 id="merchants-heading">Top card merchants</h3>
    {!data.outgoingComplete ? <Notice tone="warning">Card payments can&apos;t all be read right now.</Notice>
      : data.topMerchants.length ? <ul className="inBars">{data.topMerchants.map((item) => <li key={item.name} data-testid="top-merchant">
        <button type="button" className="inBarRow" onClick={() => onMerchant(item.name)}>
          <span className="inBarName"><strong>{item.name}</strong><small>{`${item.payments} payment${item.payments === 1 ? "" : "s"}`}</small></span>
          <span className="inBar" aria-hidden="true"><i style={{ width: `${Math.max(4, (item.total / peak) * 100)}%` }} /></span>
          <strong className="inBarValue">{exact(item.total)}</strong>
        </button></li>)}</ul>
        : <p className="mxHint">No card payments in this period.</p>}
  </section>;
}

/** The chart is opened once and stays open on this device; storage can be refused, and then it starts closed. */
function useChartOpen() {
  // The summary's numbers, and so this toggle, only draw in the browser, after sign-in is known.
  const [open, setOpen] = useState(() => { try { return window.localStorage.getItem(CHART_KEY) === "open"; } catch { return false; } });
  return [open, (next: boolean) => {
    setOpen(next);
    try { window.localStorage.setItem(CHART_KEY, next ? "open" : "closed"); } catch { /* remembered for this visit only */ }
  }] as const;
}

type Props = {
  data: Summary | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  days: Period;
  onDays: (days: Period) => void;
  /** The total the list is narrowed to, if any. */
  total: SummaryTotal | null;
  onTotal: (total: SummaryTotal) => void;
  onMerchant: (name: string) => void;
};

/**
 * Journey J14, on top of Transactions: money in, money out, added to Earn, and
 * swapped over a period. Each total narrows the list below to the transactions
 * it adds up. The chart and top merchants open on request.
 */
export function TransactionsSummary({ data, loading, error, onRetry, days, onDays, total, onTotal, onMerchant }: Props) {
  const [chartOpen, setChartOpen] = useChartOpen();
  const detailsId = useId();
  const totals: Array<{ key: SummaryTotal; value?: number; testId?: string }> = data ? [
    { key: "in", value: data.incomingComplete ? data.totals.incoming : undefined, testId: "money-in" },
    { key: "out", value: data.outgoingComplete ? data.totals.outgoing : undefined, testId: "money-out" },
    { key: "earn", value: data.totals.allocation },
    { key: "moved", value: data.totals.movement }
  ] : [];
  return <section className="mxCard txSummary" aria-labelledby="summary-heading">
    <div className="txSummaryHead"><h2 id="summary-heading">Summary</h2>
      <div className="appSegmented" role="group" aria-label="Summary period">{PERIODS.map((period) =>
        <button key={period} type="button" aria-label={periodName(period)} aria-pressed={days === period} onClick={() => onDays(period)}>{period === 365 ? "1Y" : `${period}D`}</button>)}</div></div>
    {loading ? <div className="inStats" role="status" aria-label="Loading your summary">{Object.values(totalName).map((name) =>
      <div className="txStat" key={name}><span className="txStatLabel">{name}</span><span className="txSkel" /></div>)}</div>
      : error || !data ? <Notice tone="error" role="alert" onRetry={onRetry}>Your summary can&apos;t be loaded right now.</Notice>
        : <>
          <ul className="inStats">{totals.map((item) => <li key={item.key}>{item.value === undefined
            ? <div className="txStat"><span className="txStatLabel">{totalName[item.key]}</span><strong data-testid={item.testId} className="appUnavailable">Unavailable</strong></div>
            : <button type="button" className="txStat" aria-pressed={total === item.key} onClick={() => onTotal(item.key)}
              aria-label={`${totalName[item.key]} ${whole(item.value)}, show these transactions`}>
              <span className="txStatLabel">{totalName[item.key]}</span><strong data-testid={item.testId}>{whole(item.value)}</strong></button>}</li>)}</ul>
          <p className="mxHint">Completed transactions in the last {periodName(days)}. Crypto you received is valued at today&apos;s price.
            {data.totals.unvalued > 0 && ` ${data.totals.unvalued} with no dollar value ${data.totals.unvalued === 1 ? "is" : "are"} left out.`}</p>
          <button type="button" className="appTextButton txSummaryToggle" aria-expanded={chartOpen} aria-controls={detailsId} onClick={() => setChartOpen(!chartOpen)}>
            {chartOpen ? "Hide chart and merchants" : "Show chart and merchants"}<ChevronDown aria-hidden="true" /></button>
          <div id={detailsId} className="txSummaryDetails" hidden={!chartOpen}>{chartOpen && <><InOutChart data={data} /><TopMerchants data={data} onMerchant={onMerchant} /></>}</div>
        </>}
  </section>;
}
