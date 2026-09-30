"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, LoaderCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { useOverview } from "@/lib/client/queries";
import type { AaveBaseReserve } from "@/lib/defi/aave";
import { formatToken, fromRaw } from "@/lib/format";
import { EarnAction, type EarnOption } from "./earn-action";
import { GuestBanner } from "./guest-banner";
import { LiveAmount, positionUsd } from "./live-amount";

type AaveResponse = { reserves: AaveBaseReserve[]; observedAt: string };
type VaultsResponse = { vaults: Array<{ id: string; address: string; name: string; curator: string; assetSymbol: string;
  rate: { netApyPct: number; totalAssetsUsd: number; liquidityUsd: number } | null }>; observedAt: string | null };

const millions = (usd: number) => `$${(usd / 1_000_000).toFixed(1)}m`;

type Card = { key: string; option: EarnOption; symbol: string; title: string; by: string; about: string;
  apy: string | null; liquidity: string | null; deposits: string | null; positionId: string };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Earn on Base (journey J8): your positions first, growing live, then every way to earn. Supply USDC or WETH to Aave,
 * or deposit USDC into a Morpho vault; each opens to deposit or withdraw. Rates are live market data, shown as
 * unavailable when they can't be read. Positions come from the chain, through the Overview. Guests see labelled
 * example positions with the live rates.
 */
export function EarnWorkspace() {
  const { getAccessToken, authenticated, ready, login } = usePrivy();
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
        positionId: `aave:8453:${(symbol === "USDC" ? "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" : "0x4200000000000000000000000000000000000006")}` };
    }),
    ...(vaults.data?.vaults ?? []).map((vault): Card => ({ key: vault.id, option: { protocol: "morpho", vault: vault.id, label: vault.name }, symbol: vault.assetSymbol,
      title: vault.name, by: `Morpho on Base, curated by ${vault.curator}`,
      about: `A USDC vault that ${vault.curator} spreads across Morpho lending markets. No fee.`,
      apy: vault.rate ? `${vault.rate.netApyPct.toFixed(2)}%` : null, liquidity: vault.rate ? millions(vault.rate.liquidityUsd) : null,
      deposits: vault.rate ? millions(vault.rate.totalAssetsUsd) : null, positionId: `morpho:8453:${vault.address}` }))
  ];
  const position = (id: string) => overview.data?.holdings.find((holding) => holding.id === id);

  const positions = cards.flatMap((card) => {
    const held = position(card.positionId);
    return held && held.amountRaw !== "0" ? [{ card, held }] : [];
  });
  const earnTotal = overview.data?.totals.earn;
  // A failed read of the positions is unavailable, never "no positions" or zero.
  const positionsUnavailable = !overview.data && Boolean(overview.error);
  const toggle = (key: string) => setOpen((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);

  return <div className="mxPage erPage">
    {(isExample || !ready) && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="mxHead"><h1>Earn</h1></header>
    <p className="mxNote erNote"><ShieldCheck aria-hidden="true" /><span><strong>Your account holds every position.</strong> Rates change, withdrawals depend on each market&apos;s liquidity, and your deposit isn&apos;t guaranteed.</span></p>

    <section className="mxCard erPositions" aria-labelledby="earn-positions">
      <div className="erSectionHead"><h2 id="earn-positions">Your positions</h2>
        {earnTotal && positions.length > 0 && <strong className="sensitiveAmount">{usd.format(earnTotal.usdCents / 100)}{earnTotal.partial ? " + unavailable" : ""}</strong>}</div>
      {overview.isPending ? <div className="mxState" role="status"><LoaderCircle className="spin" aria-hidden="true" />Reading your positions</div>
        : positionsUnavailable ? <p className="mxNote mxNoteWarning" role="alert" data-testid="earn-positions-unavailable"><span className="erUnavailable">Unavailable.</span> We couldn&apos;t read your positions just now.{" "}
          <button type="button" className="appTextButton mxInlineButton" onClick={() => overview.refetch()}>Try again</button></p>
        : positions.length === 0 ? <p className="mxHint">No positions yet. Choose where to earn below, then deposit.</p>
          : <ul className="erList">{positions.map(({ card, held }) => <li key={card.key}>
            <span className="erName"><strong>{card.title}</strong><small>{card.by}</small></span>
            <span className="erValue sensitiveAmount"><strong>{held.status === "unavailable" ? "Unavailable" : positionUsd(held) !== null
              ? <LiveAmount usd={positionUsd(held)!} apyPct={held.apyPct} observedAt={held.observedAt} /> : formatToken(fromRaw(held.amountRaw ?? "0", held.decimals), held.symbol, { maxDecimals: 6 })}</strong>
              <small>{card.apy ? `Earning ${card.apy} a year` : "Rate unavailable"}</small></span>
          </li>)}</ul>}
    </section>

    <section className="erOptions" aria-labelledby="earn-options">
      <h2 id="earn-options" className="erSectionTitle">Markets and vaults</h2>
      {(aave.isPending || vaults.isPending) && <div className="mxState" role="status"><LoaderCircle className="spin" aria-hidden="true" /><div><strong>Reading rates</strong> Loading Aave and Morpho on Base.</div></div>}
      {cards.map((card) => {
        const held = position(card.positionId);
        const expanded = open.includes(card.key);
        return <article className="mxCard erOption" key={card.key} aria-label={card.title}>
          <div className="erOptionTop">
            <span className="erName"><strong>{card.title}</strong><small>{card.by}</small></span>
            <span className="erRate"><strong data-testid={`apy-${card.key}`} className={card.apy ? undefined : "erUnavailable"}>{card.apy ?? "Unavailable"}</strong><small>Rate (APY)</small></span>
          </div>
          <p className="mxHint">{card.about}</p>
          <dl className="mxSummary erFacts">
            <div><dt>Can be withdrawn now</dt><dd className={card.liquidity ? undefined : "erUnavailable"}>{card.liquidity ?? "Unavailable"}</dd></div>
            <div><dt>Total deposits</dt><dd className={card.deposits ? undefined : "erUnavailable"}>{card.deposits ?? "Unavailable"}</dd></div>
            <div><dt>Your position</dt><dd className={`sensitiveAmount${held?.status === "unavailable" || (!held && positionsUnavailable) ? " erUnavailable" : ""}`} data-testid={`position-${card.key}`}>
              {held?.status === "unavailable" || (!held && positionsUnavailable) ? "Unavailable"
                : held?.amountRaw && held.amountRaw !== "0" && positionUsd(held) !== null
                  ? <span className="erHeld"><LiveAmount usd={positionUsd(held)!} apyPct={held.apyPct} observedAt={held.observedAt} />
                    <small>{formatToken(fromRaw(held.amountRaw, held.decimals), held.symbol, { maxDecimals: 6 })}</small></span>
                  : held?.amountRaw && held.amountRaw !== "0" ? formatToken(fromRaw(held.amountRaw, held.decimals), held.symbol, { maxDecimals: 6 }) : `0 ${card.symbol}`}</dd></div>
          </dl>
          {isExample ? <button type="button" className="appButton erToggle" onClick={login}>Sign in to deposit</button>
            : <>
              <button type="button" className="appButton erToggle" aria-expanded={expanded} aria-controls={`earn-action-${card.key}`} onClick={() => toggle(card.key)}>
                Deposit or withdraw<ChevronDown aria-hidden="true" className="erChevron" /></button>
              <div id={`earn-action-${card.key}`} hidden={!expanded}>
                <EarnAction option={card.option} symbol={card.symbol} hasPosition={Boolean(held?.amountRaw && held.amountRaw !== "0")} />
              </div>
            </>}
        </article>;
      })}
    </section>
    {(aave.error || vaults.error) && <p className="mxNote mxNoteWarning" role="status">{[aave.error?.message, vaults.error?.message].filter(Boolean).join(" ")}</p>}
    <p className="mxHint">Rates are current, not a forecast. Aave rates come from Aave, Morpho rates from Morpho, and your positions from the chain.</p>
  </div>;
}
