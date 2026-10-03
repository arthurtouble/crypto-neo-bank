"use client";

import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/lib/client/auth";
import { formatCompactUsd, formatFunding, formatPrice, formatSignedPercent, formatSignedPrice, perpDex, perpName, dayChangePercent } from "@/lib/markets/view";
import { usePerpMarkets, usePerpsAccount, type PerpMarket } from "./markets-data";
import { NotAvailableYet, SourceLine, useIsPhone } from "./markets-parts";
import { GuestBanner } from "./guest-banner";
import { PerpsBook } from "./perps-book";
import { PerpsChart } from "./perps-chart";
import { PerpsActivity } from "./perps-home";
import { PerpsOrderForm, PerpsOrderSheet } from "./perps-sheets";
import { LoadingState, Notice } from "./states";

/**
 * One perp market, as a trading screen. Desktop: the price, its stats, the
 * chart, and the customer's positions on the left; the order book in the
 * middle; the order panel on the right, always open. Phone: one column, the
 * order book as a tab beside positions, and Long and Short opening the order
 * sheet.
 */
export function PerpsMarketPage({ coin }: { coin: string }) {
  const { ready, authenticated, login } = useAuth();
  const phone = useIsPhone();
  const markets = usePerpMarkets();
  const account = usePerpsAccount();
  const [side, setSide] = useState<"long" | "short">("long");
  const [sheet, setSheet] = useState(false);
  const list = markets.data?.markets;
  const all = list?.status === "observed" ? list.data : [];
  const market = all.find((item) => item.coin === coin);
  const name = perpName(coin);
  const guest = !ready || !authenticated;

  const body = markets.switchedOff ? <NotAvailableYet name="Perps" />
    : markets.isPending ? <LoadingState label={`Reading ${name}`} />
      : !list || list.status !== "observed" ? <Notice tone="warning" role="alert" onRetry={() => void markets.refetch()}><span className="appUnavailable">Unavailable.</span> We couldn&apos;t read this market from Hyperliquid.</Notice>
        : !market ? <section className="mkEmpty"><h2>This market isn&apos;t available</h2><p>Hyperliquid doesn&apos;t list {name} right now.</p></section>
          : <>
            <div className="mkTrade">
              <div className="mkTradeMain">
                <Quote market={market} observedAt={list.observedAt} isExample={markets.isExample} />
                <PerpsChart coin={coin} name={name} />
                <PerpsActivity account={account.data} isPending={account.isPending} isExample={account.isExample} coin={coin}
                  extra={phone ? { label: "Order book", render: () => <PerpsBook coin={coin} name={name} depth={8} framed={false} /> } : undefined} />
              </div>
              {!phone && <PerpsBook coin={coin} name={name} />}
              {!phone && <aside className="mxCard mkOrderPanel" aria-label="Place an order">
                <PerpsOrderForm key={market.coin} market={market} side={side} onSide={setSide} account={account.data} variant="panel" onDone={() => undefined} />
              </aside>}
            </div>
            {phone && <div className="mkTradeBar">
              <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => { if (guest) login(); else { setSide("long"); setSheet(true); } }}>Long</button>
              <button type="button" className="appButton appButtonLarge" onClick={() => { if (guest) login(); else { setSide("short"); setSheet(true); } }}>Short</button>
            </div>}
            {phone && sheet && <PerpsOrderSheet market={market} side={side} account={account.data} onClose={() => setSheet(false)} />}
          </>;

  return <div className="mxPage mkPage mkPerpPage">
    {guest && <GuestBanner onSignIn={login} ready={ready} />}
    <nav className="mkCrumbs" aria-label="Breadcrumb">
      <ol>
        <li><Link href="/app/markets">Perps</Link></li>
        <li>{perpDex(coin) ? "Stocks" : "Crypto"}</li>
        <li aria-current="page" className="mkCrumbMarket">
          <h1><MarketSwitcher coin={coin} markets={all} /></h1>
          {market && <span className="mkBadge">{market.maxLeverage}x</span>}
        </li>
      </ol>
    </nav>
    {body}
    {phone && <p className="mxHint mkRisk">Trades happen on Hyperliquid, from an account your wallet owns. Aura charges no fee. With leverage, a small price move can wipe out what you put in.</p>}
  </div>;
}

/** The price now, its change over the day in dollars and percent, and the market's volume, open interest, and funding. */
function Quote({ market, observedAt, isExample }: { market: PerpMarket; observedAt: string; isExample: boolean }) {
  const name = perpName(market.coin);
  const dex = perpDex(market.coin);
  const percent = dayChangePercent(market.markPx, market.prevDayPx);
  const change = percent === null ? null : Number(market.markPx) - Number(market.prevDayPx);
  return <section className="mkQuote" aria-label={`${name} price`}>
    <p className="mkQuotePrice"><span className="mkHero" data-testid="perps-market-price">{formatPrice(market.markPx) ?? <span className="appUnavailable">Unavailable</span>}</span>
      {change === null || percent === null ? <span className="appUnavailable">Unavailable</span>
        : <span className={change > 0 ? "mkUp" : "mkFlat"} data-testid="perps-market-change">{formatSignedPrice(change)} ({formatSignedPercent(percent)}) today</span>}</p>
    <dl className="mkStats" data-testid="perps-market-stats">
      <div><dt>24h volume</dt><dd>{formatCompactUsd(market.dayNtlVlm) ?? "Unavailable"}</dd></div>
      <div><dt>Open interest</dt><dd>{formatCompactUsd(Number(market.openInterest) * Number(market.markPx)) ?? "Unavailable"}</dd></div>
      <div><dt>Funding, hourly</dt><dd>{formatFunding(market.funding) ?? "Unavailable"}</dd></div>
    </dl>
    <small className="mkQuoteNote">{dex ? `A stock perp on the ${dex} market on Hyperliquid. It tracks the share price; you don't own the share.`
      : `A perpetual future on ${name}. You don't own ${name}; longs and shorts pay each other funding every hour.`} <SourceLine source="hyperliquid" observedAt={observedAt} example={isExample} /></small>
  </section>;
}

/** The market's name, which opens a list of every market to switch to: crypto first, then stocks. */
function MarketSwitcher({ coin, markets }: { coin: string; markets: PerpMarket[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", escape); };
  }, [open]);
  const needle = query.trim().toLowerCase();
  const shown = markets.filter((item) => !needle || perpName(item.coin).toLowerCase().includes(needle));
  const groups = [{ label: "Crypto", items: shown.filter((item) => !perpDex(item.coin)) }, { label: "Stocks", items: shown.filter((item) => perpDex(item.coin)) }];
  return <span className="mkSwitch" ref={root}>
    <button type="button" ref={button} className="mkSwitchButton" aria-expanded={open} aria-controls={id} disabled={markets.length === 0}
      onClick={() => setOpen((value) => !value)}>{perpName(coin)}<ChevronDown aria-hidden="true" /></button>
    {open && <div className="mkSwitcher" id={id} role="dialog" aria-label="Switch market">
      <label className="mkSearch"><Search aria-hidden="true" /><span className="srOnly">Search markets</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search markets" /></label>
      {groups.filter((group) => group.items.length > 0).map((group) => <div key={group.label} className="mkSwitchGroup">
        <h2>{group.label}</h2>
        <ul>{group.items.map((item) => <li key={item.coin}>
          <Link href={`/app/markets/perps/${encodeURIComponent(item.coin)}`} aria-current={item.coin === coin ? "page" : undefined} onClick={() => setOpen(false)}>
            <strong>{perpName(item.coin)}</strong><span className="mkBadge">{item.maxLeverage}x</span><span>{formatPrice(item.markPx) ?? "—"}</span></Link>
        </li>)}</ul>
      </div>)}
      {shown.length === 0 && <p className="mxHint">No market matches “{query}”.</p>}
    </div>}
  </span>;
}
