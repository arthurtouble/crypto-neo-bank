"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/lib/client/api";
import { ArrowDownLeft, ArrowUpRight, ChartNoAxesCombined, Layers3, LoaderCircle } from "lucide-react";
import { useState } from "react";

type Insights = {
  periodDays: number;
  completedCount: number;
  totals: { incoming: number; outgoing: number; allocation: number; movement: number; unvalued: number };
  categories: Array<{ name: string; value: number }>;
  /** False when money received couldn't all be read: money in is then unknown, not zero. */
  incomingComplete: boolean;
};

const periods = [7, 30, 90, 365] as const;
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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
          <article><span><ArrowUpRight size={16} /> Money Out</span><strong data-testid="money-out">{money.format(query.data.totals.outgoing)}</strong></article>
          <article><span><ArrowDownLeft size={16} /> Money In</span><strong data-testid="money-in">{query.data.incomingComplete ? money.format(query.data.totals.incoming) : "Unavailable"}</strong></article>
          <article><span><ChartNoAxesCombined size={16} /> Put to Work</span><strong>{money.format(query.data.totals.allocation)}</strong></article>
          <article><span><Layers3 size={16} /> Moved</span><strong>{money.format(query.data.totals.movement)}</strong></article>
        </div>
        <div className="insightCategories"><h3>By Category</h3>{query.data.categories.length ? query.data.categories.map((item) => <div className="insightCategory" key={item.name}><span>{item.name}</span><div><i style={{ width: `${Math.max(4, (item.value / peak) * 100)}%` }} /></div><strong>{money.format(item.value)}</strong></div>) : <div className="emptyState compact"><ChartNoAxesCombined size={22} /><strong>No completed activity in this period</strong><span>Your insights appear as actions are completed.</span></div>}</div>
        {query.data.totals.unvalued > 0 && <p className="authorityFootnote">{query.data.totals.unvalued} completed action{query.data.totals.unvalued === 1 ? "" : "s"} could not be valued in dollars and is excluded.</p>}
      </>}
    </section>
    <p className="authorityFootnote">Insights use completed transactions: yours from Aura, and money you received. Received amounts are valued at today&apos;s price. They aren&apos;t a bank statement or tax report.</p>
  </div>;
}

