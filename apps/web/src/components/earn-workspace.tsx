"use client";

import { useAuth } from "@/lib/client/auth";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useOverview } from "@/lib/client/queries";
import type { AaveBaseReserve } from "@/lib/defi/aave";
import { MORPHO_VAULTS } from "@/lib/defi/morpho";
import type { Holding } from "@/lib/overview/read";
import { formatCents, formatToken, fromRaw } from "@/lib/format";
import { EarnAction, type EarnOption } from "./earn-action";
import { MoneyPage } from "./money-page";
import { LoadingState, Notice, Unavailable } from "./states";

type AaveResponse = { reserves: AaveBaseReserve[]; observedAt: string };
type VaultsResponse = { vaults: Array<{ id: string; rate: { netApyPct: number } | null }>; observedAt: string | null };

const assetAddress = { USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", WETH: "0x4200000000000000000000000000000000000006" } as const;

type Card = { key: string; option: EarnOption; symbol: string; title: string; by: string; about: string;
  apy: string | null; positionId: string; assetId: string; withdrawOnly?: boolean };

/** A yearly rate with two decimals, or null when it isn't a number. */
const rateText = (pct: number | string | undefined) => {
  const value = typeof pct === "string" ? Number(pct) : pct;
  return value !== undefined && Number.isFinite(value) ? `${value.toFixed(2)}%` : null;
};

/**
 * The card a link names, as `?position=<holding id>&action=deposit|withdraw` (the Overview's Earn holdings link here):
 * the holding id is the card's position id, so the card opens on that tab.
 */
function linkedCard(position: string | null, action: string | null): { key: string; direction: "deposit" | "withdraw" } | null {
  const id = position?.toLowerCase();
  const direction = action === "deposit" ? "deposit" : action === "withdraw" ? "withdraw" : null;
  if (!id || !direction) return null;
  const aave = (["USDC", "WETH"] as const).find((symbol) => id === `aave:8453:${assetAddress[symbol]}`);
  if (aave) return aave === "WETH" && direction === "deposit" ? null : { key: `aave-${aave}`, direction };
  const vault = MORPHO_VAULTS.find((item) => id === `morpho:8453:${item.address}`);
  return vault ? { key: vault.id, direction } : null;
}

/** A position in dollars as last read from the chain, or its token amount when it has no price. */
const positionText = (held: Holding) => held.usdCents !== null ? formatCents(held.usdCents)
  : formatToken(fromRaw(held.amountRaw ?? "0", held.decimals), held.symbol, { maxDecimals: 6 });

/**
 * Earn on Base (journey J8): your positions first, in dollars as last read, then every way to earn. Supply USDC to Aave,
 * or deposit USDC into a Morpho vault; each opens to deposit or withdraw. Aave WETH takes no deposits, so it shows only
 * to an account that still holds a WETH position, to withdraw it. The options are the reviewed list, so they and their
 * positions show even when a rate service is down. Rates are live market data: one that can't be read, or whose
 * latest refresh failed, shows as unavailable, never as the last number. Positions come from the chain, through the
 * Overview. Guests see labelled example positions with the live rates.
 */
export function EarnWorkspace() {
  const { authenticated, ready, login } = useAuth();
  const isExample = ready && !authenticated;
  const params = useSearchParams();
  const [linked] = useState(() => linkedCard(params.get("position"), params.get("action")));
  const [open, setOpen] = useState<string[]>(linked ? [linked.key] : []);
  const overview = useOverview();
  const aave = useQuery<AaveResponse>({
    queryKey: ["aave-base-market"],
    queryFn: async () => {
      const response = await fetch("/api/defi/aave/markets", { cache: "no-store" });
      if (!response.ok) throw new Error("Aave");
      return response.json() as Promise<AaveResponse>;
    },
    refetchInterval: 60_000
  });
  const vaults = useQuery<VaultsResponse>({
    queryKey: ["morpho-vaults"],
    queryFn: async () => {
      const response = await fetch("/api/defi/morpho/vaults", { cache: "no-store" });
      if (!response.ok) throw new Error("Morpho");
      return response.json() as Promise<VaultsResponse>;
    },
    refetchInterval: 60_000
  });

  // A refresh that fails keeps react-query's last data; a rate that is no longer current shows as unavailable instead.
  const reserve = (symbol: string) => aave.isError ? undefined : aave.data?.reserves.find((item) => item.symbol === symbol);
  const vaultRate = (id: string) => vaults.isError ? null : vaults.data?.vaults.find((vault) => vault.id === id)?.rate ?? null;
  const cards: Card[] = [
    ...(["USDC", "WETH"] as const).map((symbol): Card => {
      const data = reserve(symbol);
      return { key: `aave-${symbol}`, option: { protocol: "aave", asset: symbol, label: `Aave ${symbol}` }, symbol, title: `Aave ${symbol}`, by: "Aave",
        about: symbol === "WETH" ? "Aave WETH no longer takes deposits. You can still withdraw what you put in."
          : `Aave lends your ${symbol} to borrowers. The rate moves with how much people borrow.`,
        apy: rateText(data?.supplyApyPct), withdrawOnly: symbol === "WETH",
        positionId: `aave:8453:${assetAddress[symbol]}`, assetId: `8453:${assetAddress[symbol]}` };
    }),
    ...MORPHO_VAULTS.map((vault): Card => ({ key: vault.id, option: { protocol: "morpho", vault: vault.id, label: vault.name }, symbol: vault.assetSymbol,
      title: vault.name, by: `Morpho, managed by ${vault.curator}`,
      about: `${vault.curator} spreads your USDC across several Morpho lending markets. No fee.`,
      apy: rateText(vaultRate(vault.id)?.netApyPct), positionId: `morpho:8453:${vault.address}`, assetId: `8453:${assetAddress.USDC}` }))
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
  // Said once for both, with the names of whichever can't be read; each card already shows its own as unavailable.
  const ratesDown = [aave.isError || (aave.data && !reserve("USDC")) ? "Aave" : null,
    vaults.isError || (vaults.data && MORPHO_VAULTS.some((vault) => !vaultRate(vault.id))) ? "Morpho" : null].filter(Boolean);
  const retryRates = () => { if (ratesDown.includes("Aave")) void aave.refetch(); if (ratesDown.includes("Morpho")) void vaults.refetch(); };
  const balance = (assetId: string) => overview.data?.holdings.find((holding) => holding.id === assetId);
  // Bring a linked card into view once the cards are on the page.
  useEffect(() => {
    if (linked && !ratesPending) document.getElementById(`earn-card-${linked.key}`)?.scrollIntoView({ block: "start" });
  }, [linked, ratesPending]);
  const toggle = (key: string) => setOpen((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);

  return <MoneyPage title="Earn" guest={isExample || !ready} onSignIn={login} ready={ready} className="erPage">
    <p className="mxNote erNote"><ShieldCheck aria-hidden="true" /><span><strong>Every position stays in your own account.</strong> Rates change, withdrawals depend on how much is available, and your deposit isn&apos;t guaranteed.</span></p>

    <section className="mxCard erPositions" aria-labelledby="earn-positions">
      <div className="erSectionHead"><h2 id="earn-positions">Your positions</h2>
        {earnTotal && positions.length > 0 && <strong className="sensitiveAmount">{formatCents(earnTotal.usdCents)}{earnTotal.partial ? " + unavailable" : ""}</strong>}</div>
      {overview.isPending ? <LoadingState label="Loading your positions" />
        : positionsUnavailable ? <Notice tone="warning" role="alert" data-testid="earn-positions-unavailable" onRetry={() => overview.refetch()}>
          <Unavailable>Unavailable.</Unavailable> Your positions can&apos;t be loaded right now.</Notice>
        : positions.length === 0 ? <p className="mxHint">No positions yet. Choose where to earn below, then deposit.</p>
          : <ul className="erList">{positions.map(({ card, held }) => <li key={card.key}>
            <span className="erName"><strong>{card.title}</strong><small>{card.by}</small></span>
            <span className="erValue sensitiveAmount"><strong>{held.status === "unavailable" ? "Unavailable" : positionText(held)}</strong>
              <small className={card.apy ? undefined : "appUnavailable"}>{card.apy ? `Earning ${card.apy} a year` : "Rate unavailable"}</small></span>
          </li>)}</ul>}
    </section>

    <section className="erOptions" aria-labelledby="earn-options">
      <h2 id="earn-options" className="erSectionTitle">Ways to earn</h2>
      {ratesPending ? <LoadingState label="Loading rates" />
        : cards.map((card) => {
          const held = position(card.positionId);
          const holds = Boolean(held?.amountRaw && held.amountRaw !== "0");
          const heldUnavailable = held?.status === "unavailable" || (!held && positionsUnavailable);
          const expanded = open.includes(card.key);
          // Once open, it stays while the withdrawal finishes, even after the position reaches zero.
          if (card.withdrawOnly && !holds && !expanded && held?.status !== "unavailable") return null;
          const wallet = balance(card.assetId);
          return <article className="mxCard erOption" key={card.key} id={`earn-card-${card.key}`} aria-label={card.title}>
            <div className="erOptionTop">
              <span className="erName"><strong>{card.title}</strong><small>{card.by}</small></span>
              <span className="erRate"><strong data-testid={`apy-${card.key}`} className={card.apy ? undefined : "appUnavailable"}>{card.apy ?? "Unavailable"}</strong>{card.apy && <small>a year</small>}</span>
            </div>
            <p className="mxHint">{card.about}</p>
            {/* Only where there is something to say: an option you don't hold has no position row. */}
            {(holds || heldUnavailable) && <dl className="mxSummary erFacts">
              <div><dt>Your position</dt><dd className={`sensitiveAmount${heldUnavailable ? " appUnavailable" : ""}`} data-testid={`position-${card.key}`}>
                {heldUnavailable || !held ? "Unavailable" : <span className="erHeld">{positionText(held)}
                  {held.usdCents !== null && <small>{formatToken(fromRaw(held.amountRaw!, held.decimals), held.symbol, { maxDecimals: 6 })}</small>}</span>}</dd></div>
            </dl>}
            {isExample ? <button type="button" className="appButton erToggle" onClick={login}>Sign in to deposit</button>
              : <>
                <button type="button" className="appButton erToggle" aria-expanded={expanded} aria-controls={`earn-action-${card.key}`} onClick={() => toggle(card.key)}>
                  {card.withdrawOnly ? "Withdraw" : "Deposit or withdraw"}<ChevronDown aria-hidden="true" className="erChevron" /></button>
                <div id={`earn-action-${card.key}`} hidden={!expanded}>
                  <EarnAction option={card.option} initialDirection={linked?.key === card.key ? linked.direction : undefined} symbol={card.symbol} hasPosition={holds} withdrawOnly={card.withdrawOnly}
                    walletRaw={wallet?.status === "observed" ? wallet.amountRaw ?? "0" : overview.data && !wallet ? "0" : null}
                    positionRaw={held?.status === "observed" ? held.amountRaw ?? "0" : overview.data && !held ? "0" : null} decimals={card.symbol === "WETH" ? 18 : 6} />
                </div>
              </>}
          </article>;
        })}
    </section>
    {ratesDown.length > 0 && <Notice tone="warning" role="status" data-testid="earn-rates-unavailable" onRetry={retryRates}>
      {ratesDown.join(" and ")} rates can&apos;t be loaded right now.</Notice>}
    <p className="mxHint">Rates are what each option pays now, not a forecast. Aave and Morpho set them.</p>
  </MoneyPage>;
}
