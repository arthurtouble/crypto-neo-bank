"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/client/auth";
import { useApi } from "@/lib/client/api";
import { formatShortDateTime, formatToken, formatUsd } from "@/lib/format";
import type { PerpPosition } from "@/lib/markets/hyperliquid/info";
import { formatCompactUsd, formatPrice, formatSignedPercent, formatSignedUsd, perpDex, perpName, positionSide } from "@/lib/markets/view";
import { perpsPositions, perpsTotals, usePerpMarkets, usePerpsAccount, type PerpMarket, type PerpOrder, type PerpsAccount } from "./markets-data";
import { Change, failureMessage, ListTabs, NotAvailableYet, SourceLine } from "./markets-parts";
import { PerpsMoneySheet, PositionSheet } from "./perps-sheets";
import { LoadingState, Notice } from "./states";

/**
 * Perps home: the perps account's value and what's available, with Add money
 * and Withdraw; positions, open orders, and history; then every market with
 * search. Read from Hyperliquid each time; a read that fails says Unavailable.
 */
export function PerpsHome() {
  const markets = usePerpMarkets();
  const account = usePerpsAccount();
  const [query, setQuery] = useState("");
  const list = markets.data?.markets;
  const shown = useMemo(() => {
    if (list?.status !== "observed") return [];
    const term = query.trim().toLowerCase();
    return [...list.data].filter((market) => !term || market.coin.toLowerCase().includes(term))
      .sort((a, b) => Number(b.dayNtlVlm) - Number(a.dayNtlVlm));
  }, [list, query]);

  if (markets.switchedOff || account.switchedOff) return <NotAvailableYet name="Perps" />;
  return <div className="mkSection">
    <PerpsAccountCard account={account.data} isExample={account.isExample} isPending={account.isPending} failed={Boolean(account.error)} onRetry={() => void account.refetch()} />
    <PerpsActivity account={account.data} isPending={account.isPending} isExample={account.isExample} />
    <section className="mxCard mkMarkets" aria-labelledby="perps-markets">
      <div className="mkCardHead"><h2 id="perps-markets">All markets</h2>
        {list && <SourceLine source="hyperliquid" observedAt={list.observedAt} example={markets.isExample} />}</div>
      <label className="mkSearch"><Search aria-hidden="true" /><span className="srOnly">Search markets</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search markets" /></label>
      {markets.isPending ? <LoadingState label="Reading Hyperliquid's markets" />
        : !list || list.status !== "observed" ? <Notice tone="warning" role="alert" onRetry={() => void markets.refetch()} data-testid="perps-markets-unavailable">
          <span className="appUnavailable">Unavailable.</span> We couldn&apos;t read Hyperliquid&apos;s markets just now.</Notice>
          : shown.length === 0 ? <p className="mxHint">No market matches “{query}”.</p>
            : <ul className="mkRows" aria-label="Perp markets">{shown.map((market) => <MarketRow key={market.coin} market={market} />)}</ul>}
    </section>
  </div>;
}

function MarketRow({ market }: { market: PerpMarket }) {
  const dex = perpDex(market.coin);
  return <li><Link className="mkRow" href={`/app/markets/perps/${encodeURIComponent(market.coin)}`}>
    <span className="appIconDisc mkTicker" aria-hidden="true">{perpName(market.coin).slice(0, 4)}</span>
    <span className="mkRowMain"><strong>{perpName(market.coin)} <span className="mkBadge">{market.maxLeverage}x</span></strong>
      <small>{dex ? "Stock perp · " : ""}{formatCompactUsd(market.dayNtlVlm) ?? "—"} vol</small></span>
    <span className="mkRowEnd"><strong>{formatPrice(market.markPx) ?? <span className="appUnavailable">Unavailable</span>}</strong>
      <small><Change price={market.markPx} prevDayPrice={market.prevDayPx} /></small></span>
  </Link></li>;
}

function PerpsAccountCard({ account, isExample, isPending, failed, onRetry }: { account: PerpsAccount | undefined; isExample: boolean; isPending: boolean; failed: boolean; onRetry: () => void }) {
  const { login } = useAuth();
  const [sheet, setSheet] = useState<"add" | "withdraw" | null>(null);
  const totals = perpsTotals(account);
  const open = (mode: "add" | "withdraw") => isExample ? login() : setSheet(mode);
  return <section className="mxCard mkAccount" aria-labelledby="perps-account">
    <div className="mkCardHead"><h2 id="perps-account">Perps account</h2>
      {account && <SourceLine source="hyperliquid" observedAt={account.dexStates.observedAt} example={isExample} />}</div>
    {isPending ? <LoadingState label="Reading your perps account" />
      : failed && !account ? <Notice tone="warning" role="alert" onRetry={onRetry}><span className="appUnavailable">Unavailable.</span> We couldn&apos;t read your perps account.</Notice>
        : <>
          <p className="mkHero" data-testid="perps-account-value">{totals ? formatUsd(totals.value) : <span className="appUnavailable">Unavailable</span>}</p>
          <div className="mkAvailable">
            <span><small>Available</small><strong data-testid="perps-available">{totals ? formatUsd(totals.available) : <span className="appUnavailable">Unavailable</span>}</strong></span>
            <span className="mkAvailableActions">
              <button type="button" className="appButton" onClick={() => open("withdraw")}><Minus aria-hidden="true" />Withdraw</button>
              <button type="button" className="appButton" onClick={() => open("add")}><Plus aria-hidden="true" />Add money</button>
            </span>
          </div>
          {!isExample && !account?.connection && totals?.value === 0 && <p className="mxHint">Add USDC from your Aura account to start. You need at least $6.</p>}
        </>}
    {sheet && <PerpsMoneySheet mode={sheet} account={account} onClose={() => setSheet(null)} />}
  </section>;
}

type ActivityTab = "positions" | "orders" | "history" | "extra";

/** Positions, open orders, and fills, for every market or one. */
export function PerpsActivity({ account, isPending, isExample, coin, extra }: { account: PerpsAccount | undefined; isPending: boolean; isExample: boolean; coin?: string;
  /** One more tab after History, such as the order book on a market's page on the phone. */
  extra?: { label: string; render: () => React.ReactNode } }) {
  const [tab, setTab] = useState<ActivityTab>("positions");
  const positions = perpsPositions(account)?.filter((item) => !coin || item.coin === coin) ?? null;
  const orders = account?.orders.status === "observed" ? account.orders.data.filter((item) => !coin || item.coin === coin) : null;
  const fills = account?.fills.status === "observed" ? account.fills.data.filter((item) => !coin || item.coin === coin) : null;
  return <section className="mxCard mkActivity" aria-label={coin ? `Your ${perpName(coin)} activity` : "Your perps activity"}>
    <ListTabs label="Your perps" value={tab} onChange={setTab} options={[
      { value: "positions", label: "Positions", count: positions?.length }, { value: "orders", label: "Open orders", count: orders?.length }, { value: "history", label: "History" },
      ...(extra ? [{ value: "extra" as const, label: extra.label }] : [])]} />
    <div role="tabpanel">
      {tab === "extra" && extra ? extra.render()
        : isPending ? <LoadingState label="Reading your perps account" />
        : tab === "positions" ? positions === null ? <UnavailableList what="positions" />
          : positions.length === 0 ? <p className="mxHint mkEmptyLine">No open positions.</p>
            : <ul className="mkRows">{positions.map((position) => <PositionRow key={position.coin} position={position} readOnly={isExample} />)}</ul>
          : tab === "orders" ? orders === null ? <UnavailableList what="orders" />
            : orders.length === 0 ? <p className="mxHint mkEmptyLine">No open orders.</p>
              : <ul className="mkRows">{orders.map((order) => <OrderRow key={order.oid} order={order} />)}</ul>
            : fills === null ? <UnavailableList what="history" />
              : fills.length === 0 ? <p className="mxHint mkEmptyLine">No trades yet.</p>
                : <ul className="mkRows">{fills.map((fill) => <li key={fill.tid} className="mkRow mkStatic">
                  <span className="mkRowMain"><strong>{fill.dir} {perpName(fill.coin)}</strong><small>{formatToken(fill.size, perpName(fill.coin))} at {formatPrice(fill.px)} · {formatShortDateTime(fill.time)}</small></span>
                  <span className="mkRowEnd">{Number(fill.closedPnl) !== 0 ? <strong className={Number(fill.closedPnl) > 0 ? "mkUp" : undefined}>{formatSignedUsd(Number(fill.closedPnl))}</strong> : null}
                    <small>Fee {formatUsd(fill.fee)}</small></span>
                </li>)}</ul>}
    </div>
  </section>;
}

const UnavailableList = ({ what }: { what: string }) => <p className="mxHint mkEmptyLine"><span className="appUnavailable">Unavailable.</span> We couldn&apos;t read your {what} from Hyperliquid.</p>;

function PositionRow({ position, readOnly }: { position: PerpPosition; readOnly: boolean }) {
  const { authenticated, login } = useAuth();
  const [sheet, setSheet] = useState<"close" | "auto-close" | null>(null);
  const side = positionSide(position.size);
  const pnl = Number(position.unrealizedPnl);
  const act = (mode: "close" | "auto-close") => !authenticated || readOnly ? login() : setSheet(mode);
  return <li className="mkRow mkStatic mkPosition" aria-label={`${perpName(position.coin)} ${side}`}>
    <span className="mkRowMain"><strong>{perpName(position.coin)} <span className={`mkBadge ${side === "long" ? "mkBadgeLong" : ""}`}>{side === "long" ? "Long" : "Short"} {position.leverage.value}x</span></strong>
      <small>{formatToken(Math.abs(Number(position.size)), perpName(position.coin))} · entry {formatPrice(position.entryPx)} · liquidation {formatPrice(position.liquidationPx) ?? "none"}</small></span>
    <span className="mkRowEnd"><strong>{formatUsd(position.positionValue)}</strong>
      <small className={pnl > 0 ? "mkUp" : undefined}>{formatSignedUsd(pnl)} ({formatSignedPercent(Number(position.returnOnEquity) * 100)})</small></span>
    <span className="mkRowActions">
      <button type="button" className="appButton" onClick={() => act("auto-close")}>Auto-close</button>
      <button type="button" className="appButton" onClick={() => act("close")}>Close</button>
    </span>
    {sheet && <PositionSheet position={position} mode={sheet} onClose={() => setSheet(null)} />}
  </li>;
}

function OrderRow({ order }: { order: PerpOrder }) {
  const { authenticated, login } = useAuth();
  const api = useApi();
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  async function cancel() {
    if (!authenticated) return login();
    setState({ busy: true, error: null });
    try {
      await api("/api/perps/orders/cancel", { method: "POST", json: { coin: order.coin, oid: order.oid } });
      await queryClient.invalidateQueries({ queryKey: ["perps-account"] });
      setState({ busy: false, error: null });
    } catch (error) { setState({ busy: false, error: failureMessage(error) }); }
  }
  const price = order.isTrigger ? `at ${formatPrice(order.triggerPx)}` : `at ${formatPrice(order.limitPx)}`;
  return <li className="mkRow mkStatic">
    <span className="mkRowMain"><strong>{order.side === "buy" ? "Buy" : "Sell"} {perpName(order.coin)}</strong>
      <small>{order.orderType}{order.reduceOnly ? " · closes only" : ""} · {formatToken(order.size, perpName(order.coin))} {price}</small>
      {state.error && <small className="mxFieldError" role="alert">{state.error}</small>}</span>
    <span className="mkRowActions"><button type="button" className="appButton" disabled={state.busy} onClick={() => void cancel()}>{state.busy ? "Cancelling…" : "Cancel"}</button></span>
  </li>;
}
