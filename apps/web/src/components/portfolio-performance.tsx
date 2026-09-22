"use client";

import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

type Range = "7D" | "1M" | "3M" | "1Y";
type HistoryResponse = { history: { prices: Array<[number, number]> }; observedAt: string; authority: string };
const ranges: Record<Range, number> = { "7D": 7, "1M": 30, "3M": 90, "1Y": 365 };

function compact(value: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", notation: value >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value);
}

function linePath(values: number[], width: number, height: number) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  return values.map((value, index) => {
    const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / spread) * (height - 12) - 6;
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export function PortfolioPerformance({ stableBalance, etherBalance }: { stableBalance: number; etherBalance: number }) {
  const [range, setRange] = useState<Range>("1M");
  const history = useQuery<HistoryResponse>({
    queryKey: ["portfolio-market-history", range],
    queryFn: async () => {
      const response = await fetch(`/api/market-data?view=history&id=ethereum&days=${ranges[range]}`);
      if (!response.ok) throw new Error("Value history is unavailable.");
      return response.json();
    },
    staleTime: 300_000
  });
  const points = useMemo(() => history.data?.history.prices.map(([time, price]) => ({ time, value: stableBalance + etherBalance * price })) ?? [], [etherBalance, history.data, stableBalance]);
  const sampled = useMemo(() => {
    const step = Math.max(1, Math.floor(points.length / 90));
    return points.filter((_, index) => index % step === 0 || index === points.length - 1);
  }, [points]);
  const values = sampled.map((point) => point.value);
  const latest = values.at(-1) ?? stableBalance;
  const first = values[0] ?? latest;
  const change = first ? ((latest - first) / first) * 100 : 0;
  const path = linePath(values, 720, 190);

  return <section className="panel portfolioPerformance">
    <div className="portfolioChartHeader"><div><span>Portfolio Value</span><strong className="sensitiveAmount">{compact(latest)}</strong><small className={change >= 0 ? "positive" : "negative"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}% for {range}</small></div><div className="chartRanges" aria-label="Chart range">{(Object.keys(ranges) as Range[]).map((item) => <button key={item} type="button" className={range === item ? "active" : ""} aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}</div></div>
    <div className="portfolioChart" aria-label={`Estimated portfolio value over ${range}`}>
      {history.isPending ? <div className="chartState"><LoaderCircle className="spin" size={18} /> Loading value history</div> : history.error ? <div className="chartState">Value history is temporarily unavailable.</div> : <svg viewBox="0 0 720 200" role="img" aria-label={`Portfolio value ${change >= 0 ? "rose" : "fell"} ${Math.abs(change).toFixed(2)} percent`} preserveAspectRatio="none"><defs><linearGradient id="portfolio-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".22"/><stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs><path className="chartArea" d={`${path} L720,200 L0,200 Z`} /><path className="chartLine" d={path} /></svg>}
    </div>
    <div className="chartFoot"><span>{sampled[0] ? new Date(sampled[0].time).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</span><small>Current holdings at historical market prices</small><span>{sampled.at(-1) ? new Date(sampled.at(-1)!.time).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</span></div>
  </section>;
}
