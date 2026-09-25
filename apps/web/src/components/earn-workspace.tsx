"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import type { AaveBaseReserve } from "@/lib/defi/aave";
import { AaveAction } from "./aave-action";
import { SkyVaultCard } from "./sky-vault-card";

type MarketResponse = { market: string; chainId: number; name: string; reserves: AaveBaseReserve[]; observedAt: string; authority: string };

export function EarnWorkspace() {
  const { getAccessToken } = usePrivy();
  const { address } = useAuraWallet();
  const market = useQuery<MarketResponse>({
    queryKey: ["aave-base-market", address],
    queryFn: async () => {
      const token = address ? await getAccessToken() : null;
      const response = await fetch(`/api/defi/aave/markets${address ? `?address=${address}` : ""}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Live Aave market data is unavailable.");
      return response.json() as Promise<MarketResponse>;
    },
    refetchInterval: 60_000
  });

  return <>
    <div className="notice"><ShieldCheck size={18} /><span><strong>You stay in control.</strong> Aave positions use your wallet and your signature. Rates vary, contracts can fail, and principal is not guaranteed.</span></div>
    {market.isPending && <section className="panel walletLoading"><LoaderCircle className="spin" size={20} /><div><strong>Reading Base markets</strong><span>Loading current Aave liquidity and rates.</span></div></section>}
    {market.error && <div className="sandboxAlert error" role="alert">{market.error.message}</div>}
    <div className="strategyGrid">
      <SkyVaultCard />
      {market.data?.reserves.filter((reserve) => ["USDC", "WETH"].includes(reserve.symbol)).map((reserve) => <article className="panel strategyCard" key={reserve.symbol}>
        <div className="strategyTop"><span className="strategyGlyph">A3</span><span className="statusBadge neutral"><i /> Aave on Base</span></div>
        <p className="eyebrow">AAVE V3</p><h2>Earn with {reserve.symbol}</h2>
        <p>Supply {reserve.symbol} directly to Aave on Base. Your wallet controls the position; Aura does not operate a vault.</p>
        <div className="strategyMetrics"><div><span>Supply APY</span><strong>{reserve.supplyApyPct}%</strong></div><div><span>Liquidity</span><strong>${(Number(reserve.availableLiquidity.usd) / 1_000_000).toFixed(1)}m</strong></div><div><span>Borrow APY</span><strong>{reserve.borrowApyPct}%</strong></div></div>
        <div className="exposureList"><span><Check size={13} /> Variable rate</span><span><Check size={13} /> Aave governance</span><span><Check size={13} /> Withdraw subject to liquidity</span></div>
        <AaveAction actions={["supply", "withdraw"]} symbols={[reserve.symbol]} />
      </article>)}
    </div>
    {market.data && <p className="authorityFootnote">Observed {new Date(market.data.observedAt).toLocaleTimeString()} · Authority: {market.data.authority} · Spot APY is not a forecast.</p>}
  </>;
}
