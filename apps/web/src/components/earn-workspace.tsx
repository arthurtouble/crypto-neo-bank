"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { useOverview } from "@/lib/client/queries";
import type { AaveBaseReserve } from "@/lib/defi/aave";
import { EarnAction, type EarnOption } from "./earn-action";

type AaveResponse = { reserves: AaveBaseReserve[]; observedAt: string };
type VaultsResponse = { vaults: Array<{ id: string; address: string; name: string; curator: string; assetSymbol: string;
  rate: { netApyPct: number; totalAssetsUsd: number; liquidityUsd: number } | null }>; observedAt: string | null };

const millions = (usd: number) => `$${(usd / 1_000_000).toFixed(1)}m`;

type Card = { key: string; option: EarnOption; symbol: string; title: string; by: string; about: string;
  apy: string | null; liquidity: string | null; deposits: string | null; positionId: string };

/**
 * Earn on Base: supply USDC or WETH to Aave, or deposit USDC into a Morpho
 * vault. Rates are live market data, shown as unavailable when they can't be
 * read. Your position comes from the chain, through the Overview.
 */
export function EarnWorkspace() {
  const { getAccessToken } = usePrivy();
  const { address } = useAuraWallet();
  const overview = useOverview();
  const aave = useQuery<AaveResponse>({
    queryKey: ["aave-base-market", address],
    queryFn: async () => {
      const token = address ? await getAccessToken() : null;
      const response = await fetch(`/api/defi/aave/markets${address ? `?address=${address}` : ""}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Aave rates are unavailable right now.");
      return response.json() as Promise<AaveResponse>;
    },
    refetchInterval: 60_000
  });
  const vaults = useQuery<VaultsResponse>({
    queryKey: ["morpho-vaults"],
    queryFn: async () => {
      const response = await fetch("/api/defi/morpho/vaults", { cache: "no-store" });
      if (!response.ok) throw new Error("Morpho rates are unavailable right now.");
      return response.json() as Promise<VaultsResponse>;
    },
    refetchInterval: 60_000
  });

  const reserve = (symbol: string) => aave.data?.reserves.find((item) => item.symbol === symbol);
  const cards: Card[] = [
    ...(["USDC", "WETH"] as const).map((symbol): Card => {
      const data = reserve(symbol);
      return { key: `aave-${symbol}`, option: { protocol: "aave", asset: symbol, label: `Aave ${symbol}` }, symbol, title: `Aave ${symbol}`, by: "Aave on Base",
        about: `Lend ${symbol} to Aave's market on Base. The rate moves with borrowing demand.`,
        apy: data ? `${data.supplyApyPct}%` : null, liquidity: data ? millions(Number(data.availableLiquidity.usd)) : null,
        deposits: data ? millions(Number(data.totalSuppliedUsd)) : null,
        positionId: `aave:8453:${(symbol === "USDC" ? "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" : "0x4200000000000000000000000000000000000006")}` };
    }),
    ...(vaults.data?.vaults ?? []).map((vault): Card => ({ key: vault.id, option: { protocol: "morpho", vault: vault.id, label: vault.name }, symbol: vault.assetSymbol,
      title: vault.name, by: `Morpho on Base, curated by ${vault.curator}`,
      about: `A USDC vault that ${vault.curator} spreads across Morpho lending markets. No fee.`,
      apy: vault.rate ? `${vault.rate.netApyPct.toFixed(2)}%` : null, liquidity: vault.rate ? millions(vault.rate.liquidityUsd) : null,
      deposits: vault.rate ? millions(vault.rate.totalAssetsUsd) : null, positionId: `morpho:8453:${vault.address}` }))
  ];
  const position = (id: string) => overview.data?.holdings.find((holding) => holding.id === id);

  return <>
    <div className="notice"><ShieldCheck size={18} /><span><strong>Your account holds every position.</strong> Rates change, withdrawals depend on each market&apos;s liquidity, and your deposit isn&apos;t guaranteed.</span></div>
    {(aave.isPending || vaults.isPending) && <section className="panel walletLoading"><LoaderCircle className="spin" size={20} /><div><strong>Reading rates</strong><span>Loading Aave and Morpho on Base.</span></div></section>}
    <div className="strategyGrid">
      {cards.map((card) => {
        const held = position(card.positionId);
        return <article className="panel strategyCard" key={card.key} aria-label={card.title}>
          <div className="strategyTop"><span className="statusBadge neutral"><i /> {card.by}</span></div>
          <h2>{card.title}</h2>
          <p>{card.about}</p>
          <div className="strategyMetrics">
            <div><span>Rate (APY)</span><strong data-testid={`apy-${card.key}`}>{card.apy ?? "Unavailable"}</strong></div>
            <div><span>Can be withdrawn now</span><strong>{card.liquidity ?? "Unavailable"}</strong></div>
            <div><span>Total deposits</span><strong>{card.deposits ?? "Unavailable"}</strong></div>
          </div>
          <p className="authorityFootnote" data-testid={`position-${card.key}`}>Your position: {held?.status === "observed" && held.amountRaw
            ? `${Number(held.amountRaw) / 10 ** held.decimals} ${held.symbol}` : held?.status === "unavailable" ? "Unavailable" : `0 ${card.symbol}`}</p>
          <EarnAction option={card.option} symbol={card.symbol} hasPosition={Boolean(held?.amountRaw && held.amountRaw !== "0")} />
        </article>;
      })}
    </div>
    {(aave.error || vaults.error) && <p className="authorityFootnote" role="status">{[aave.error?.message, vaults.error?.message].filter(Boolean).join(" ")}</p>}
    <p className="authorityFootnote">Rates are current, not a forecast. Aave rates come from Aave, Morpho rates from Morpho, and your positions from the chain.</p>
  </>;
}
