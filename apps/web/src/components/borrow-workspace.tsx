"use client";

import { useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import type { AaveBaseReserve } from "@/lib/defi/aave";
import { findStringField } from "@/lib/transactions/plan";

type Market = { market: string; reserves: AaveBaseReserve[]; observedAt: string };

/** Position and market data remain visible; no wallet execution path exists. */
export function BorrowWorkspace() {
  const { wallets } = useWallets();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const market = useQuery<Market>({
    queryKey: ["aave-borrow-market", wallet?.address],
    queryFn: async () => {
      const response = await fetch(`/api/defi/aave/markets?address=${wallet?.address}`);
      if (!response.ok) throw new Error("Borrowing market unavailable.");
      return response.json();
    },
    enabled: Boolean(wallet), refetchInterval: 60_000
  });
  const position = useQuery<unknown>({
    queryKey: ["aave-position", wallet?.address],
    queryFn: async () => {
      const response = await fetch(`/api/defi/aave/positions?address=${wallet?.address}`);
      if (!response.ok) throw new Error("Position unavailable.");
      return response.json();
    },
    enabled: Boolean(wallet), refetchInterval: 30_000
  });
  const healthFactor = findStringField(position.data, ["healthFactor"]);

  return <>
    <div className="notice borrowNotice"><ShieldAlert size={18} /><span><strong>Borrow only against collateral you can afford to lose.</strong> Liquidation is automatic at the protocol level. Aura cannot stop it or restore collateral.</span></div>
    <div className="contentGrid"><section className="panel widePanel"><div className="panelHeading"><div><p className="eyebrow">AAVE V3 · BASE</p><h2>Collateral and debt</h2></div><span className="statusBadge neutral">Live protocol view</span></div>
      <div className="borrowHealth"><div><span>Current health factor</span><strong>{healthFactor ?? "No active debt"}</strong><small>Below 1.00 is liquidatable</small></div><div><span>Protocol</span><strong>Aave V3</strong><small>Onchain and noncustodial</small></div><div><span>Position source</span><strong>{position.isPending ? "Reading…" : "Observed"}</strong><small>Refreshed from Aave</small></div></div>
      <button className="button primary" disabled>Borrow and repay unavailable</button><p className="formWarning">Aave execution is paused until every call can be verified before signing.</p>
    </section><aside className="panel connectionPanel"><p className="eyebrow">AVAILABLE MARKETS</p>{market.data?.reserves.map((reserve) => <div className="rateRow" key={reserve.symbol}><span><strong>{reserve.symbol}</strong><small>${(Number(reserve.availableLiquidity.usd) / 1_000_000).toFixed(1)}m liquidity</small></span><b>{reserve.borrowApyPct}%</b></div>)}<p className="riskFineprint">Rates are variable. Available liquidity and protocol parameters can change before execution.</p></aside></div>
  </>;
}
