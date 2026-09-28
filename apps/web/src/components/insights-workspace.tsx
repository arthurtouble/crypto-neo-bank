"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/lib/client/api";
import { ArrowDownLeft, ArrowUpRight, ChartNoAxesCombined, Layers3, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { InsightBucket, InsightMerchant } from "@/lib/insights/presentation";

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
    ...(data.incomingComplete ? [{ key: "incoming" as const, name: "Money in", className: "seriesIn" }] : []),
    ...(data.outgoingComplete ? [{ key: "outgoing" as const, name: "Money out", className: "seriesOut" }] : [])
  ];
  const buckets = data.over.buckets;
  const width = 640, height = 170, top = 10, bottom = 4, left = 4;
  const plot = height - top - bottom;
  const peak = Math.max(1, ...buckets.flatMap((bucket) => series.map((item) => bucket[item.key])));
  const slot = (width - left) / Math.max(buckets.length, 1);
  const barWidth = Math.max(3, Math.min(18, (slot - 6) / Math.max(series.length, 1) - 2));
  const labelEvery = Math.ceil(buckets.length / 7);
  const shown = active === null ? null : buckets[active];
  return <section className="insightChart" aria-labelledby="in-out-heading">
    <div className="insightChartHead"><h3 id="in-out-heading">Money in and out</h3>
      {series.length > 1 && <div className="chartLegend">{series.map((item) => <span key={item.key}><i className={item.className} />{item.name}</span>)}</div>}</div>
    {!series.length ? <p className="formError">Money in and out can&apos;t all be read right now.</p> : <>
      {series.length < 2 && <p className="sourceCaption">{data.incomingComplete ? "Money out" : "Money in"} can&apos;t all be read right now, so only {series[0].name.toLowerCase()} is shown.</p>}
      <div className="insightChartPlot" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.map((item) => item.name).join(" and ")} by ${data.over.unit}`} preserveAspectRatio="none">
          <line className="chartBaseline" x1={0} x2={width} y1={top + plot} y2={top + plot} />
          {buckets.map((bucket, index) => {
            const x = left + index * slot + (slot - series.length * (barWidth + 2)) / 2;
            return <g key={bucket.start} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} onFocus={() => setActive(index)} tabIndex={-1}>
              <rect className="chartHit" x={left + index * slot} y={top} width={slot} height={plot} />
              {series.map((item, position) => {
                const value = bucket[item.key];
                const barHeight = value > 0 ? Math.max(2, (value / peak) * plot) : 0;
                return barHeight ? <path key={item.key} className={item.className} d={bar(x + position * (barWidth + 2), top + plot, barWidth, barHeight)} /> : null;
              })}
            </g>;
          })}
          {active !== null && <rect className="chartActive" x={left + active * slot} y={top} width={slot} height={plot} />}
        </svg>
        {/* Labels sit outside the SVG, which stretches to the panel's width, so the text isn't distorted. */}
        <div className="chartTicks" aria-hidden="true">{buckets.map((bucket, index) => index % labelEvery === 0
          ? <span key={bucket.start} style={{ left: `${((left + index * slot + slot / 2) / width) * 100}%` }}>{bucketLabel(bucket.start, data.over.unit)}</span> : null)}</div>
        {shown && <div className="chartTooltip" role="status" style={tooltipAt(active!, buckets.length)}>
          <strong>{bucketLabel(shown.start, data.over.unit, true)}</strong>
          {series.map((item) => <span key={item.key}><i className={item.className} />{item.name}<b>{exact.format(shown[item.key])}</b></span>)}
        </div>}
      </div>
      <details className="chartTable"><summary>Show as a table</summary>
        <table><thead><tr><th scope="col">{data.over.unit === "month" ? "Month" : data.over.unit === "week" ? "Week of" : "Day"}</th>{series.map((item) => <th scope="col" key={item.key}>{item.name}</th>)}</tr></thead>
          <tbody>{buckets.map((bucket) => <tr key={bucket.start}><th scope="row">{bucketLabel(bucket.start, data.over.unit, true)}</th>
            {series.map((item) => <td key={item.key}>{exact.format(bucket[item.key])}</td>)}</tr>)}</tbody></table>
      </details>
    </>}
  </section>;
}

/** Beside the hovered group, on whichever side has room, so it never covers the bars or leaves the panel. */
function tooltipAt(index: number, count: number) {
  const start = (index / count) * 100, end = ((index + 1) / count) * 100;
  return end <= 55 ? { left: `${end}%` } : { right: `${100 - start}%` };
}

/** A bar with a rounded top, anchored square to the baseline. */
function bar(x: number, baseline: number, width: number, height: number) {
  const radius = Math.min(4, width / 2, height);
  return `M${x},${baseline}V${baseline - height + radius}Q${x},${baseline - height} ${x + radius},${baseline - height}H${x + width - radius}Q${x + width},${baseline - height} ${x + width},${baseline - height + radius}V${baseline}Z`;
}

function TopMerchants({ data }: { data: Insights }) {
  const peak = Math.max(...data.topMerchants.map((item) => item.total), 1);
  return <section className="insightCategories" aria-labelledby="merchants-heading"><h3 id="merchants-heading">Top card merchants</h3>
    {!data.outgoingComplete ? <p className="formError">Card payments can&apos;t all be read right now.</p>
      : data.topMerchants.length ? data.topMerchants.map((item) => <div className="insightCategory" key={item.name} data-testid="top-merchant">
        <span>{item.name}<small>{item.payments} payment{item.payments === 1 ? "" : "s"}</small></span>
        <div><i style={{ width: `${Math.max(4, (item.total / peak) * 100)}%` }} /></div><strong>{exact.format(item.total)}</strong></div>)
        : <p className="sourceCaption">No card payments in this period.</p>}
  </section>;
}

export function InsightsWorkspace() {
  const { user } = usePrivy();
  const api = useApi();
  const [days, setDays] = useState<(typeof periods)[number]>(30);
  const query = useQuery<Insights>({
    queryKey: ["insights", user?.id, days],
    queryFn: () => api<Insights>(`/api/insights?days=${days}`),
    enabled: Boolean(user)
  });
  const peak = Math.max(...(query.data?.categories.map((item) => item.value) ?? [0]), 1);

  return <div className="insightsWorkspace">
    <section className="panel insightsSummary">
      <div className="panelHeading"><div><h2>Money Insights</h2></div><div className="chartRanges" aria-label="Insight period">{periods.map((period) => <button key={period} className={days === period ? "active" : ""} onClick={() => setDays(period)}>{period === 365 ? "1Y" : `${period}D`}</button>)}</div></div>
      {query.isPending ? <div className="compactState"><LoaderCircle className="spin" size={17} /> Loading insights</div> : query.isError ? <div className="formError">{query.error.message}</div> : <>
        <div className="insightMetrics">
          <article><span><ArrowUpRight size={16} /> Money Out</span><strong data-testid="money-out">{query.data.outgoingComplete ? money.format(query.data.totals.outgoing) : "Unavailable"}</strong></article>
          <article><span><ArrowDownLeft size={16} /> Money In</span><strong data-testid="money-in">{query.data.incomingComplete ? money.format(query.data.totals.incoming) : "Unavailable"}</strong></article>
          <article><span><ChartNoAxesCombined size={16} /> Put to Work</span><strong>{money.format(query.data.totals.allocation)}</strong></article>
          <article><span><Layers3 size={16} /> Moved</span><strong>{money.format(query.data.totals.movement)}</strong></article>
        </div>
        <InOutChart data={query.data} />
        <div className="insightCategories"><h3>By Category</h3>{query.data.categories.length ? query.data.categories.map((item) => <div className="insightCategory" key={item.name}><span>{item.name}</span><div><i style={{ width: `${Math.max(4, (item.value / peak) * 100)}%` }} /></div><strong>{money.format(item.value)}</strong></div>) : <div className="emptyState compact"><ChartNoAxesCombined size={22} /><strong>No completed activity in this period</strong><span>Your insights appear as actions are completed.</span></div>}</div>
        <TopMerchants data={query.data} />
        {query.data.totals.unvalued > 0 && <p className="authorityFootnote">{query.data.totals.unvalued} completed action{query.data.totals.unvalued === 1 ? "" : "s"} could not be valued in dollars and is excluded.</p>}
      </>}
    </section>
    <p className="authorityFootnote">Insights use completed transactions: yours from Aura, card payments, and money you received. Received amounts are valued at today&apos;s price. Days, weeks, and months are in UTC. They aren&apos;t a bank statement or tax report.</p>
  </div>;
}
