"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined, CircleDollarSign, Gift, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { AaveBaseRewards } from "@/lib/defi/aave";
import { useSkyPosition } from "@/lib/defi/use-sky-position";

type Overview = { marketsWithPosition: number; supplyGroups: number; borrowGroups: number; healthFactor?: string; netWorthUsd?: string };
type PositionResponse = { overview: Overview; rewards: AaveBaseRewards; observedAt: string; authority: string };

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

/** Existing Aave positions remain readable; claim execution is not enabled. */
export function DefiPositions({ address }: { address: string }) {
  const { getAccessToken } = usePrivy();
  const sky = useSkyPosition(address);
  const query = useQuery<PositionResponse>({
    queryKey: ["defi-positions", address],
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch(`/api/defi/aave/positions?address=${address}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("DeFi positions could not be loaded.");
      return response.json();
    }, refetchInterval: 30_000
  });
  const overview = query.data?.overview;
  const rewards = query.data?.rewards;

  return <><section className="panel defiPositions">
    <div className="panelHeading"><div><h2>Vaults</h2></div><span className="statusBadge neutral">Sky · Ethereum</span></div>
    {sky.isPending ? <div className="compactState"><LoaderCircle className="spin" size={16} /> Reading Sky position</div>
      : sky.isError ? <div className="formError">Sky position unavailable. Try again later.</div>
      : <div className="defiMetrics"><span><CircleDollarSign size={17} /><small>Sky sUSDS</small><strong>{amount.format(Number(sky.data.susds))} USDS</strong></span><span><CircleDollarSign size={17} /><small>Ethereum USDC</small><strong>{amount.format(Number(sky.data.usdc))} USDC</strong></span></div>}
    <div className="defiPositionFooter"><span>Balances read from Ethereum</span><Link href="/app/earn">View Sky</Link></div>
  </section><section className="panel defiPositions">
    <div className="panelHeading"><div><h2>DeFi Positions</h2></div><span className="statusBadge neutral">Aave V3</span></div>
    {query.isPending ? <div className="compactState"><LoaderCircle className="spin" size={16} /> Reading positions</div> : query.isError ? <div className="formError">{query.error.message}</div> : overview && overview.marketsWithPosition > 0 ? <><div className="defiMetrics"><span><ChartNoAxesCombined size={17} /><small>Active Markets</small><strong>{overview.marketsWithPosition}</strong></span><span><ShieldCheck size={17} /><small>Health Factor</small><strong>{overview.healthFactor ?? (overview.borrowGroups === 0 ? "No active debt" : "Unavailable")}</strong></span><span><CircleDollarSign size={17} /><small>Net Position</small><strong>{overview.netWorthUsd ? money.format(Number(overview.netWorthUsd)) : "Unavailable"}</strong></span></div><div className="defiPositionFooter"><span>{overview.supplyGroups} supplied · {overview.borrowGroups} borrowed</span><Link href="/app/activity">View Transactions</Link></div></> : <div className="emptyState compact"><ChartNoAxesCombined size={22} /><strong>No Aave positions found</strong><span>Positions appear here directly from Aave after settlement.</span><div className="emptyActions"><Link className="button secondary small" href="/app/earn">Explore Earn</Link><Link className="button secondary small" href="/app/borrow">Borrow</Link></div></div>}
    {rewards && rewards.items.length > 0 && <section className="defiRewards"><div className="defiRewardsHeading"><span><Gift size={17} /><strong>Aave rewards</strong></span><strong>{money.format(Number(rewards.totalUsd))}</strong></div><div className="defiRewardRows">{rewards.items.map((item) => <div key={`${item.tokenAddress}-${item.symbol}`}><span><strong>{item.name}</strong><small>{item.symbol}</small></span><span><strong>{amount.format(Number(item.amount))}</strong><small>{money.format(Number(item.usd))}</small></span></div>)}</div></section>}
    {query.data && <p className="authorityFootnote">Observed {new Date(query.data.observedAt).toLocaleTimeString()} · Aave and public-chain data remain authoritative.</p>}
  </section></>;
}
