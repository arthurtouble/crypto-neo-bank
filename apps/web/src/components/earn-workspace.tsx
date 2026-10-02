"use client";

import { useAuth } from "@/lib/client/auth";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { useOverview } from "@/lib/client/queries";
import type { AaveBaseReserve } from "@/lib/defi/aave";
import type { Holding } from "@/lib/overview/read";
import { formatCents, formatToken, fromRaw } from "@/lib/format";
import { EarnAction, type EarnOption } from "./earn-action";
import { MoneyPage } from "./money-page";
import { LoadingState, Notice, Unavailable } from "./states";

type AaveResponse = { reserves: AaveBaseReserve[]; observedAt: string };
type VaultsResponse = { vaults: Array<{ id: string; address: string; name: string; curator: string; assetSymbol: string;
  rate: { netApyPct: number; totalAssetsUsd: number; liquidityUsd: number } | null }>; observedAt: string | null };

const millions = (usd: number) => `$${(usd / 1_000_000).toFixed(1)}m`;
const assetAddress = { USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", WETH: "0x4200000000000000000000000000000000000006" } as const;

type Card = { key: string; option: EarnOption; symbol: string; title: string; by: string; about: string;
  apy: string | null; liquidity: string | null; deposits: string | null; positionId: string; assetId: string };

/** A position in dollars as last read from the chain, or its token amount when it has no price. */
const positionText = (held: Holding) => held.usdCents !== null ? formatCents(held.usdCents)
  : formatToken(fromRaw(held.amountRaw ?? "0", held.decimals), held.symbol, { maxDecimals: 6 });

/**
 * Earn on Base (journey J8): your positions first, in dollars as last read, then every way to earn. Supply USDC or WETH to Aave,
 * or deposit USDC into a Morpho vault; each opens to deposit or withdraw. Rates are live market data, shown as
 * unavailable when they can't be read. Positions come from the chain, through the Overview. Guests see labelled
 * example positions with the live rates.
 */
export function EarnWorkspace() {
  const { getAccessToken, authenticated, ready, login } = useAuth();
  const isExample = ready && !authenticated;
  const [open, setOpen] = useState<string[]>([]);
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
        positionId: `aave:8453:${assetAddress[symbol]}`, assetId: `8453:${assetAddress[symbol]}` };
    }),
    ...(vaults.data?.vaults ?? []).map((vault): Card => ({ key: vault.id, option: { protocol: "morpho", vault: vault.id, label: vault.name }, symbol: vault.assetSymbol,
      title: vault.name, by: `Morpho on Base, curated by ${vault.curator}`,
      about: `A USDC vault that ${vault.curator} spreads across Morpho lending markets. No fee.`,
      apy: vault.rate ? `${vault.rate.netApyPct.toFixed(2)}%` : null, liquidity: vault.rate ? millions(vault.rate.liquidityUsd) : null,
      deposits: vault.rate ? millions(vault.rate.totalAssetsUsd) : null, positionId: `morpho:8453:${vault.address}`, assetId: `8453:${assetAddress.USDC}` }))
  ];
  const position = (id: string) => overview.data?.holdings.find((holding) => holding.id === id);

  const positions = cards.flatMap((card) => {
    const held = position(card.positionId);
    return held && held.amountRaw !== "0" ? [{ card, held }] : [];
  });
  const earnTotal = overview.data?.totals.earn;
  // A failed read of the positions is unavailable, never "no positions" or zero.
  const positionsUnavailable = !overview.data && Boolean(overview.error);
  // Rates and the vault list arrive together, so the cards appear once, without jumping.
  const ratesPending = aave.isPending || vaults.isPending;
  // Morpho's rate service failing still lists the vaults, each without a rate.
  const morphoRatesUnavailable = Boolean(vaults.data?.vaults.length) && vaults.data!.vaults.every((vault) => vault.rate === null);
  const ratesNotice = [aave.error?.message, vaults.error?.message ?? (morphoRatesUnavailable ? "Morpho rates are unavailable right now." : undefined)].filter(Boolean);
  const balance = (assetId: string) => overview.data?.holdings.find((holding) => holding.id === assetId);
  const toggle = (key: string) => setOpen((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);

  return <MoneyPage title="Earn" guest={isExample || !ready} onSignIn={login} ready={ready} className="erPage">
    <p className="mxNote erNote"><ShieldCheck aria-hidden="true" /><span><strong>Your account holds every position.</strong> Rates change, withdrawals depend on each market&apos;s liquidity, and your deposit isn&apos;t guaranteed.</span></p>

    <section className="mxCard erPositions" aria-labelledby="earn-positions">
      <div className="erSectionHead"><h2 id="earn-positions">Your positions</h2>
        {earnTotal && positions.length > 0 && <strong className="sensitiveAmount">{formatCents(earnTotal.usdCents)}{earnTotal.partial ? " + unavailable" : ""}</strong>}</div>
      {overview.isPending ? <LoadingState label="Reading your positions" />
        : positionsUnavailable ? <Notice tone="warning" role="alert" data-testid="earn-positions-unavailable" onRetry={() => overview.refetch()}>
          <Unavailable>Unavailable.</Unavailable> We couldn&apos;t read your positions just now.</Notice>
        : positions.length === 0 ? <p className="mxHint">No positions yet. Choose where to earn below, then deposit.</p>
          : <ul className="erList">{positions.map(({ card, held }) => <li key={card.key}>
            <span className="erName"><strong>{card.title}</strong><small>{card.by}</small></span>
            <span className="erValue sensitiveAmount"><strong>{held.status === "unavailable" ? "Unavailable" : positionText(held)}</strong>
              <small>{card.apy ? `Earning ${card.apy} a year` : "Rate unavailable"}</small></span>
          </li>)}</ul>}
    </section>

    <section className="erOptions" aria-labelledby="earn-options">
      <h2 id="earn-options" className="erSectionTitle">Markets and vaults</h2>
      {ratesPending ? <LoadingState><div><strong>Reading rates</strong> Loading Aave and Morpho on Base.</div></LoadingState>
        : cards.map((card) => {
          const held = position(card.positionId);
          const holds = Boolean(held?.amountRaw && held.amountRaw !== "0");
          const expanded = open.includes(card.key);
          const wallet = balance(card.assetId);
          return <article className="mxCard erOption" key={card.key} aria-label={card.title}>
            <div className="erOptionTop">
              <span className="erName"><strong>{card.title}</strong><small>{card.by}</small></span>
              <span className="erRate"><strong data-testid={`apy-${card.key}`} className={card.apy ? undefined : "appUnavailable"}>{card.apy ?? "Unavailable"}</strong><small>Rate (APY)</small></span>
            </div>
            <p className="mxHint">{card.about}</p>
            <dl className="mxSummary erFacts">
              <div><dt>Can be withdrawn now</dt><dd className={card.liquidity ? undefined : "appUnavailable"}>{card.liquidity ?? "Unavailable"}</dd></div>
              <div><dt>Total deposits</dt><dd className={card.deposits ? undefined : "appUnavailable"}>{card.deposits ?? "Unavailable"}</dd></div>
              <div><dt>Your position</dt><dd className={`sensitiveAmount${held?.status === "unavailable" || (!held && positionsUnavailable) ? " appUnavailable" : ""}`} data-testid={`position-${card.key}`}>
                {overview.isPending ? "Reading"
                  : held?.status === "unavailable" || (!held && positionsUnavailable) ? "Unavailable"
                  : held && holds ? <span className="erHeld">{positionText(held)}
                    {held.usdCents !== null && <small>{formatToken(fromRaw(held.amountRaw!, held.decimals), held.symbol, { maxDecimals: 6 })}</small>}</span>
                  : `0 ${card.symbol}`}</dd></div>
            </dl>
            {isExample ? <button type="button" className="appButton erToggle" onClick={login}>Sign in to deposit</button>
              : <>
                <button type="button" className="appButton erToggle" aria-expanded={expanded} aria-controls={`earn-action-${card.key}`} onClick={() => toggle(card.key)}>
                  Deposit or withdraw<ChevronDown aria-hidden="true" className="erChevron" /></button>
                <div id={`earn-action-${card.key}`} hidden={!expanded}>
                  <EarnAction option={card.option} symbol={card.symbol} hasPosition={holds}
                    walletRaw={wallet?.status === "observed" ? wallet.amountRaw ?? "0" : overview.data && !wallet ? "0" : null}
                    positionRaw={held?.status === "observed" ? held.amountRaw ?? "0" : overview.data && !held ? "0" : null} decimals={card.symbol === "WETH" ? 18 : 6} />
                </div>
              </>}
          </article>;
        })}
    </section>
    {ratesNotice.length > 0 && <Notice tone="warning" role="status">{ratesNotice.join(" ")}</Notice>}
    <p className="mxHint">Rates are current, not a forecast. Aave rates come from Aave, Morpho rates from Morpho, and your positions from the chain.</p>
  </MoneyPage>;
}
