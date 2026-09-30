"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/client/api";
import { exampleInsightActivity, exampleInsightsNow } from "@/lib/example/data";
import { buildInsights, type InsightBucket, type InsightMerchant } from "@/lib/insights/presentation";
import { GuestBanner } from "./guest-banner";

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
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

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
    {!series.length ? <p className="mxNote mxNoteWarning">Money in and out can&apos;t all be read right now.</p> : <>
      {series.length < 2 && <p className="mxHint">{data.incomingComplete ? "Money out" : "Money in"} can&apos;t all be read right now, so only {series[0].name.toLowerCase()} is shown.</p>}
      <div className="inPlot" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.map((item) => item.name).join(" and ")} by ${data.over.unit}`} preserveAspectRatio="none">
          {/* The highlight goes under the bars, so it never hides them. */}
          {active !== null && <rect className="inActive" x={left + active * slot} y={top} width={slot} height={plot} />}
          <line className="inBaseline" x1={0} x2={width} y1={top + plot} y2={top + plot} />
          {buckets.map((bucket, index) => {
            const x = left + index * slot + (slot - series.length * (barWidth + 2)) / 2;
            return <g key={bucket.start} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} onFocus={() => setActive(index)} tabIndex={-1}>
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

function Categories({ data }: { data: Insights }) {
  const peak = Math.max(...data.categories.map((item) => item.value), 1);
  return <section className="mxCard" aria-labelledby="categories-heading"><h2 id="categories-heading">By category</h2>
    {data.categories.length ? <ul className="inBars">{data.categories.map((item) => <BarRow key={item.name} name={item.name} value={item.value} peak={peak} />)}</ul>
      : <div className="txEmpty"><strong>No completed activity in this period</strong><span>Your insights appear as actions are completed.</span></div>}
  </section>;
}

function TopMerchants({ data }: { data: Insights }) {
  const peak = Math.max(...data.topMerchants.map((item) => item.total), 1);
  return <section className="mxCard" aria-labelledby="merchants-heading"><h2 id="merchants-heading">Top card merchants</h2>
    {!data.outgoingComplete ? <p className="mxNote mxNoteWarning">Card payments can&apos;t all be read right now.</p>
      : data.topMerchants.length ? <ul className="inBars">{data.topMerchants.map((item) => <BarRow key={item.name} testId="top-merchant" name={item.name}
        note={`${item.payments} payment${item.payments === 1 ? "" : "s"}`} value={item.total} peak={peak} />)}</ul>
        : <p className="mxHint">No card payments in this period.</p>}
  </section>;
}

/** Journey J14: money in and out over a period, a chart with a table view, categories, and top card merchants. */
export function InsightsWorkspace() {
  const { user, ready, authenticated, login } = usePrivy();
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
    { label: "Put to work", value: money.format(data.totals.allocation) },
    { label: "Moved", value: money.format(data.totals.movement) }
  ] : [];

  return <div className="mxPage txPage inPage">
    {(isExample || loading) && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="txHead"><h1>Insights</h1>
      <div className="appSegmented" role="group" aria-label="Insight period">{periods.map((period) =>
        <button key={period} type="button" aria-pressed={days === period} onClick={() => setDays(period)}>{period === 365 ? "1Y" : `${period}D`}</button>)}</div></header>
    {loading || (!isExample && query.isPending) ? <div className="txState" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Loading insights</div>
      : !data ? <p className="mxNote mxNoteError" role="alert">{query.error?.message ?? "Insights couldn't be loaded."} <button type="button" className="appTextButton mxInlineButton" onClick={() => void query.refetch()}>Try again</button></p>
        : <>
          <dl className="inStats">{stats.map((stat) => <div key={stat.label}><dt>{stat.label}</dt>
            <dd data-testid={stat.testId} className={stat.unavailable ? "inUnavailable" : undefined}>{stat.value}</dd></div>)}</dl>
          <InOutChart data={data} />
          <div className="inCards"><Categories data={data} /><TopMerchants data={data} /></div>
          {data.totals.unvalued > 0 && <p className="mxHint">{data.totals.unvalued} completed action{data.totals.unvalued === 1 ? "" : "s"} could not be valued in dollars and {data.totals.unvalued === 1 ? "is" : "are"} left out.</p>}
        </>}
    <p className="mxHint">Insights use completed transactions: yours from Aura, card payments, and money you received. Received amounts are valued at today&apos;s price. Days, weeks, and months are in UTC. They aren&apos;t a bank statement or tax report.</p>
  </div>;
}
