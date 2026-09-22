"use client";

import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined, CircleDollarSign, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";

type Overview = { marketsWithPosition: number; supplyGroups: number; borrowGroups: number; healthFactor?: string; netWorthUsd?: string; rewardsStatus: "not_reported" };
type Response = { overview: Overview; observedAt: string; authority: string };

export function DefiPositions({ address }: { address: string }) {
  const query = useQuery<Response>({
    queryKey: ["defi-positions", address],
    queryFn: async () => {
      const response = await fetch(`/api/defi/aave/positions?address=${address}`, { cache: "no-store" });
      if (!response.ok) throw new Error("DeFi positions could not be loaded.");
      return response.json();
    }, refetchInterval: 30_000
  });
  const overview = query.data?.overview;
  return <section className="panel defiPositions">
    <div className="panelHeading"><div><h2>DeFi Positions</h2></div><span className="statusBadge neutral">Aave V3</span></div>
    {query.isPending ? <div className="compactState"><LoaderCircle className="spin" size={16} /> Reading positions</div> : query.isError ? <div className="formError">{query.error.message}</div> : overview && overview.marketsWithPosition > 0 ? <><div className="defiMetrics"><span><ChartNoAxesCombined size={17} /><small>Active Markets</small><strong>{overview.marketsWithPosition}</strong></span><span><ShieldCheck size={17} /><small>Health Factor</small><strong>{overview.healthFactor ?? "No active debt"}</strong></span><span><CircleDollarSign size={17} /><small>Net Position</small><strong>{overview.netWorthUsd ? `$${Number(overview.netWorthUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "Source unavailable"}</strong></span></div><div className="defiPositionFooter"><span>{overview.supplyGroups} supplied · {overview.borrowGroups} borrowed</span><span>Rewards not reported by Aave position source</span></div></> : <div className="emptyState compact"><ChartNoAxesCombined size={22} /><strong>No Aave positions found</strong><span>Positions appear here directly from Aave after settlement.</span><div className="emptyActions"><Link className="button secondary small" href="/app/earn">Explore Earn</Link><Link className="button secondary small" href="/app/borrow">Borrow</Link></div></div>}
    {query.data && <p className="authorityFootnote">Observed {new Date(query.data.observedAt).toLocaleTimeString()} · Aave and public-chain data remain authoritative.</p>}
  </section>;
}

