"use client";

import Link from "next/link";
import { useAuth } from "@/lib/client/auth";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/client/api";
import { exampleInsightActivity, exampleInsightsNow } from "@/lib/example/data";
import { formatUsd } from "@/lib/format";
import { buildInsights, type InsightBucket, type InsightMerchant } from "@/lib/insights/presentation";
import { GuestBanner } from "./guest-banner";
import { LoadingState, Notice } from "./states";

type Insights = {
  periodDays: number;
  completedCount: number;
  totals: { incoming: number; outgoing: number; allocation: number; movement: number; unvalued: number };
  categories: Array<{ name: string; value: number }>;
  over: { unit: "day" | "week" | "month"; buckets: InsightBucket[] };
  topMerchants: InsightMerchant[];
  /** False when money received or card refunds couldn't all be read: money in is then unknown, not zero. */
  incomingComplete: boolean;
  /** False when card payments couldn't all be read: money out is then unknown. */
  outgoingComplete: boolean;
};

const periods = [7, 30, 90, 365] as const;
const periodName = (days: number) => days === 365 ? "1 year" : `${days} days`;
const money = { format: (value: number) => formatUsd(value, { whole: true }) };
const exact = { format: (value: number) => formatUsd(value) };

function bucketLabel(start: string, unit: Insights["over"]["unit"], long = false) {
  const date = new Date(start);
  if (unit === "month") return date.toLocaleDateString(undefined, { month: long ? "long" : "short", year: long ? "numeric" : undefined, timeZone: "UTC" });
  const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  return unit === "week" && long ? `Week of ${day}` : day;
}

/** Money in and out per day, week, or month: two series side by side on one axis, with a hover readout and a table. */
function InOutChart({ data }: { data: Insights }) {
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
  return <section className="mxCard inChart" aria-labelledby="in-out-heading">
    <div className="inChartHead"><h2 id="in-out-heading">Money in and out</h2>
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
          {series.map((item) => <span key={item.key}><i className={item.className} />{item.name}<b>{exact.format(shown[item.key])}</b></span>)}
        </div>}
      </div>
      <details className="inTable"><summary>Show as a table</summary>
        <table><thead><tr><th scope="col">{data.over.unit === "month" ? "Month" : data.over.unit === "week" ? "Week of" : "Day"}</th>{series.map((item) => <th scope="col" key={item.key}>{item.name}</th>)}</tr></thead>
          <tbody>{buckets.map((bucket) => <tr key={bucket.start}><th scope="row">{bucketLabel(bucket.start, data.over.unit, true)}</th>
            {series.map((item) => <td key={item.key}>{exact.format(bucket[item.key])}</td>)}</tr>)}</tbody></table>
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

/** A row with a name, a bar against the largest, and an amount. */
function BarRow({ name, note, value, peak, testId }: { name: string; note?: string; value: number; peak: number; testId?: string }) {
  return <li className="inBarRow" data-testid={testId}>
    <span className="inBarName"><strong>{name}</strong>{note && <small>{note}</small>}</span>
    <span className="inBar" aria-hidden="true"><i style={{ width: `${Math.max(4, (value / peak) * 100)}%` }} /></span>
    <strong className="inBarValue">{exact.format(value)}</strong>
  </li>;
}

function TopMerchants({ data }: { data: Insights }) {
  const peak = Math.max(...data.topMerchants.map((item) => item.total), 1);
  return <section className="mxCard" aria-labelledby="merchants-heading"><h2 id="merchants-heading">Top card merchants</h2>
    {!data.outgoingComplete ? <Notice tone="warning">Card payments can&apos;t all be read right now.</Notice>
      : data.topMerchants.length ? <ul className="inBars">{data.topMerchants.map((item) => <BarRow key={item.name} testId="top-merchant" name={item.name}
        note={`${item.payments} payment${item.payments === 1 ? "" : "s"}`} value={item.total} peak={peak} />)}</ul>
        : <p className="mxHint">No card payments in this period.</p>}
  </section>;
}

/** Shown instead of the numbers when nothing completed in the period and every source could be read. */
function NoActivity() {
  return <section className="mxCard" aria-label="No transactions in this period"><div className="txEmpty inEmpty">
    <strong>No transactions in this period</strong><span>Choose a longer period, or add money to get started.</span>
    <Link className="appButton appButtonPrimary" href="/app/deposit">Deposit</Link></div></section>;
}

/** Journey J14: money in and out over a period, a chart with a table view, and top card merchants. */
export function InsightsWorkspace() {
  const { user, ready, authenticated, login } = useAuth();
  const api = useApi();
  const isExample = ready && !authenticated;
  const loading = !ready;
  const [days, setDays] = useState<(typeof periods)[number]>(30);
  const query = useQuery<Insights>({
    queryKey: ["insights", user?.id, days],
    queryFn: () => api<Insights>(`/api/insights?days=${days}`),
    enabled: authenticated && Boolean(user)
  });
  const example = useMemo<Insights | null>(() => isExample
    ? { ...buildInsights(exampleInsightActivity, exampleInsightsNow, days), incomingComplete: true, outgoingComplete: true } : null, [isExample, days]);
  const data = example ?? query.data;

  const stats = data ? [
    { label: "Money in", value: data.incomingComplete ? money.format(data.totals.incoming) : "Unavailable", unavailable: !data.incomingComplete, testId: "money-in" },
    { label: "Money out", value: data.outgoingComplete ? money.format(data.totals.outgoing) : "Unavailable", unavailable: !data.outgoingComplete, testId: "money-out" },
    { label: "Added to Earn", value: money.format(data.totals.allocation) },
    { label: "Swapped", value: money.format(data.totals.movement) }
  ] : [];

  return <div className="mxPage txPage inPage">
    {(isExample || loading) && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="txHead"><h1>Insights</h1>
      <div className="appSegmented" role="group" aria-label="Insight period">{periods.map((period) =>
        <button key={period} type="button" aria-label={periodName(period)} aria-pressed={days === period} onClick={() => setDays(period)}>{period === 365 ? "1Y" : `${period}D`}</button>)}</div></header>
    {loading || (!isExample && query.isPending) ? <LoadingState label="Loading insights" />
      : !data ? <Notice tone="error" role="alert" onRetry={() => void query.refetch()}>{query.error?.message ?? "Insights couldn't be loaded."}</Notice>
        : !isExample && data.completedCount === 0 && data.incomingComplete && data.outgoingComplete ? <NoActivity />
        : <>
          <dl className="inStats">{stats.map((stat) => <div key={stat.label}><dt>{stat.label}</dt>
            <dd data-testid={stat.testId} className={stat.unavailable ? "appUnavailable" : undefined}>{stat.value}</dd></div>)}</dl>
          <InOutChart data={data} />
          <TopMerchants data={data} />
          {data.totals.unvalued > 0 && <p className="mxHint">{data.totals.unvalued} completed action{data.totals.unvalued === 1 ? "" : "s"} could not be valued in dollars and {data.totals.unvalued === 1 ? "is" : "are"} left out.</p>}
        </>}
    <p className="mxHint">Based on completed transactions. Money you received is valued at today&apos;s price. This isn&apos;t a bank statement or tax report.</p>
  </div>;
}
