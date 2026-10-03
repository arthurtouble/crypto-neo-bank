"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/client/auth";
import { formatCompactUsd, formatFunding, formatPrice, perpDex, perpName } from "@/lib/markets/view";
import { usePerpMarkets, usePerpsAccount } from "./markets-data";
import { Change, NotAvailableYet, SourceLine } from "./markets-parts";
import { GuestBanner } from "./guest-banner";
import { PerpsActivity } from "./perps-home";
import { PerpsOrderSheet } from "./perps-sheets";
import { LoadingState, Notice } from "./states";

/**
 * One perp market: its price, day change and volume, what it is (open
 * interest, funding), the customer's position and orders in it, and Long
 * and Short, which open the order sheet.
 */
export function PerpsMarketPage({ coin }: { coin: string }) {
  const { ready, authenticated, login } = useAuth();
  const markets = usePerpMarkets();
  const account = usePerpsAccount();
  const [side, setSide] = useState<"long" | "short" | null>(null);
  const list = markets.data?.markets;
  const market = list?.status === "observed" ? list.data.find((item) => item.coin === coin) : undefined;
  const name = perpName(coin);
  const guest = !ready || !authenticated;

  const body = markets.switchedOff ? <NotAvailableYet name="Perps" />
    : markets.isPending ? <LoadingState label={`Reading ${name}`} />
      : !list || list.status !== "observed" ? <Notice tone="warning" role="alert" onRetry={() => void markets.refetch()}><span className="appUnavailable">Unavailable.</span> We couldn&apos;t read this market from Hyperliquid.</Notice>
        : !market ? <section className="mkEmpty"><h2>This market isn&apos;t available</h2><p>Hyperliquid doesn&apos;t list {name} right now.</p></section>
          : <>
            <section className="mkQuote" aria-label={`${name} price`}>
              <p className="mkHero" data-testid="perps-market-price">{formatPrice(market.markPx) ?? <span className="appUnavailable">Unavailable</span>}</p>
              <p className="mkQuoteLine"><Change price={market.markPx} prevDayPrice={market.prevDayPx} /> today · {formatCompactUsd(market.dayNtlVlm) ?? "—"} volume</p>
              <SourceLine source="hyperliquid" observedAt={list.observedAt} example={markets.isExample} />
            </section>
            <div className="mkColumns">
              <PerpsActivity account={account.data} isPending={account.isPending} isExample={account.isExample} coin={coin} />
              <section className="mxCard" aria-labelledby="perps-about">
                <h2 id="perps-about">About</h2>
                <dl className="mxSummary">
                  <div><dt>24h change</dt><dd><Change price={market.markPx} prevDayPrice={market.prevDayPx} /></dd></div>
                  <div><dt>24h volume</dt><dd>{formatCompactUsd(market.dayNtlVlm) ?? "Unavailable"}</dd></div>
                  <div><dt>Open interest</dt><dd>{formatCompactUsd(Number(market.openInterest) * Number(market.markPx)) ?? "Unavailable"}</dd></div>
                  <div><dt>Funding, hourly</dt><dd>{formatFunding(market.funding) ?? "Unavailable"}</dd></div>
                  <div><dt>Max leverage</dt><dd>{market.maxLeverage}x{market.onlyIsolated ? ", isolated only" : ""}</dd></div>
                </dl>
                <p className="mxHint">{perpDex(coin) ? `A stock perp on the ${perpDex(coin)} market on Hyperliquid. It tracks the share price; you don't own the share.`
                  : `A perpetual future on ${name}. You don't own ${name}; funding is paid between longs and shorts every hour.`}</p>
              </section>
            </div>
            <div className="mkTradeBar">
              <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => guest ? login() : setSide("long")}>Long</button>
              <button type="button" className="appButton appButtonLarge" onClick={() => guest ? login() : setSide("short")}>Short</button>
            </div>
            {market && side && <PerpsOrderSheet market={market} side={side} account={account.data} onClose={() => setSide(null)} />}
          </>;

  return <div className="mxPage mkPage">
    {(guest) && <GuestBanner onSignIn={login} ready={ready} />}
    <Link href="/app/markets" className="mkBack"><ChevronLeft aria-hidden="true" />Markets</Link>
    <header className="mxHead mkMarketHead"><h1>{name}</h1>{market && <span className="mkBadge">{market.maxLeverage}x</span>}{perpDex(coin) && <span className="mkBadge">Stock perp</span>}</header>
    {body}
    <p className="mxHint mkRisk">Trades happen on Hyperliquid, from an account your wallet owns. Aura charges no fee. With leverage, a small price move can wipe out what you put in.</p>
  </div>;
}
