"use client";

import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined, CircleDollarSign, Gift, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { AaveBaseRewards } from "@/lib/defi/aave";

type Overview = { marketsWithPosition: number; supplyGroups: number; borrowGroups: number; healthFactor?: string; netWorthUsd?: string };
type PositionResponse = { overview: Overview; rewards: AaveBaseRewards; observedAt: string; authority: string };

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

/** Existing Aave positions remain readable; claim execution is not enabled. */
export function DefiPositions({ address }: { address: string }) {
  const query = useQuery<PositionResponse>({
    queryKey: ["defi-positions", address],
    queryFn: async () => {
      const response = await fetch(`/api/defi/aave/positions?address=${address}`, { cache: "no-store" });
      if (!response.ok) throw new Error("DeFi positions could not be loaded.");
      return response.json();
    }, refetchInterval: 30_000
  });
  const overview = query.data?.overview;
  const rewards = query.data?.rewards;

  return <section className="panel defiPositions">
    <div className="panelHeading"><div><h2>DeFi Positions</h2></div><span className="statusBadge neutral">Aave V3</span></div>
    {query.isPending ? <div className="compactState"><LoaderCircle className="spin" size={16} /> Reading positions</div> : query.isError ? <div className="formError">{query.error.message}</div> : overview && overview.marketsWithPosition > 0 ? <><div className="defiMetrics"><span><ChartNoAxesCombined size={17} /><small>Active Markets</small><strong>{overview.marketsWithPosition}</strong></span><span><ShieldCheck size={17} /><small>Health Factor</small><strong>{overview.healthFactor ?? "No active debt"}</strong></span><span><CircleDollarSign size={17} /><small>Net Position</small><strong>{overview.netWorthUsd ? money.format(Number(overview.netWorthUsd)) : "Unavailable"}</strong></span></div><div className="defiPositionFooter"><span>{overview.supplyGroups} supplied · {overview.borrowGroups} borrowed</span><Link href="/app/activity">View Activity</Link></div></> : <div className="emptyState compact"><ChartNoAxesCombined size={22} /><strong>No Aave positions found</strong><span>Positions appear here directly from Aave after settlement.</span><div className="emptyActions"><Link className="button secondary small" href="/app/earn">Explore Earn</Link><Link className="button secondary small" href="/app/borrow">Borrow</Link></div></div>}
    {rewards && rewards.items.length > 0 && <section className="defiRewards"><div className="defiRewardsHeading"><span><Gift size={17} /><strong>Claimable Rewards</strong></span><strong>{money.format(Number(rewards.totalUsd))}</strong></div><div className="defiRewardRows">{rewards.items.map((item) => <div key={`${item.tokenAddress}-${item.symbol}`}><span><strong>{item.name}</strong><small>{item.symbol}</small></span><span><strong>{amount.format(Number(item.amount))}</strong><small>{money.format(Number(item.usd))}</small></span></div>)}</div><button className="button secondary full" disabled>Claim temporarily unavailable</button><p className="formWarning">Aave claims are paused until the claim call can be verified before signing.</p></section>}
    {query.data && <p className="authorityFootnote">Observed {new Date(query.data.observedAt).toLocaleTimeString()} · Aave and public-chain data remain authoritative.</p>}
  </section>;
}
