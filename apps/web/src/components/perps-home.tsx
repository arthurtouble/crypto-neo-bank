"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/client/auth";
import { formatShortDateTime, formatToken, formatUsd } from "@/lib/format";
import type { PerpPosition } from "@/lib/markets/hyperliquid/info";
import { fillDirection, formatCompactUsd, formatPrice, formatSignedPercent, formatSignedUsd, orderKind, perpDex, perpName, PERPS_MINIMUM_DEPOSIT, positionSide } from "@/lib/markets/view";
import { perpsPositions, perpsTotals, usePerpMarkets, usePerpsAccount, type PerpMarket, type PerpOrder, type PerpsAccount } from "./markets-data";
import { Change, failureMessage, ListTabs, NotAvailableYet, SourceLine } from "./markets-parts";
import { PerpsMoneySheet, PositionCloseSheet, PositionTpslSheet, positionTriggers, usePerpsAction } from "./perps-sheets";
import { LoadingState, Notice } from "./states";

/** A perp market's page. A stock perp's coin ("xyz:SPCX") is encoded. */
export const perpHref = (coin: string) => `/app/perps/${encodeURIComponent(coin)}`;

/**
 * Perps home: the perps account's value, what's available to trade and to
 * withdraw, with Add money and Withdraw; positions, open orders, and history;
 * then every market with search. Read from Hyperliquid each time; a read that
 * fails says Unavailable.
 */
export function PerpsHome() {
  const markets = usePerpMarkets();
  const account = usePerpsAccount();
  const [query, setQuery] = useState("");
  const list = markets.data?.markets;
  const shown = useMemo(() => {
    if (list?.status !== "observed") return [];
    const term = query.trim().toLowerCase();
    return [...list.data].filter((market) => !term || perpName(market.coin).toLowerCase().includes(term))
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
          <span className="appUnavailable">Unavailable.</span> Hyperliquid&apos;s markets can&apos;t be loaded right now. Try again.</Notice>
          : shown.length === 0 ? <p className="mxHint">No market matches “{query}”.</p>
            : <ul className="mkRows" aria-label="Perp markets">{shown.map((market) => <MarketRow key={market.coin} market={market} />)}</ul>}
    </section>
  </div>;
}

function MarketRow({ market }: { market: PerpMarket }) {
  const dex = perpDex(market.coin);
  return <li><Link className="mkRow" href={perpHref(market.coin)}>
    <span className="appIconDisc mkTicker" aria-hidden="true">{perpName(market.coin).slice(0, 4)}</span>
    <span className="mkRowMain"><strong>{perpName(market.coin)} <span className="mkBadge">{market.maxLeverage}x</span></strong>
      <small>{dex ? "Stock perp · " : ""}{formatCompactUsd(market.dayNtlVlm) ?? "—"} traded in 24h</small></span>
    <span className="mkRowEnd"><strong>{formatPrice(market.markPx) ?? <span className="appUnavailable">Unavailable</span>}</strong>
      <small><Change price={market.markPx} prevDayPrice={market.prevDayPx} /></small></span>
  </Link></li>;
}

function PerpsAccountCard({ account, isExample, isPending, failed, onRetry }: { account: PerpsAccount | undefined; isExample: boolean; isPending: boolean; failed: boolean; onRetry: () => void }) {
  const { login } = useAuth();
  const [sheet, setSheet] = useState<"add" | "withdraw" | null>(null);
  const totals = perpsTotals(account);
  const open = (mode: "add" | "withdraw") => isExample ? login() : setSheet(mode);
  const unavailable = <span className="appUnavailable">Unavailable</span>;
  // A new or emptied account: nothing to withdraw, so Add money is the one thing to do.
  const empty = !isExample && totals !== null && totals.value === 0 && totals.withdrawable === 0;
  const locked = account?.blocked?.reason === "locked";
  return <section className="mxCard mkAccount" aria-labelledby="perps-account">
    <div className="mkCardHead"><h2 id="perps-account">Perps account</h2>
      {account && <SourceLine source="hyperliquid" observedAt={account.dexStates.observedAt} example={isExample} />}</div>
    {isPending ? <LoadingState label="Reading your perps account" />
      : failed && !account ? <Notice tone="warning" role="alert" onRetry={onRetry}><span className="appUnavailable">Unavailable.</span> Your perps account can&apos;t be loaded from Hyperliquid right now. Try again.</Notice>
        : <>
          <p className="mkHero" data-testid="perps-account-value">{totals ? formatUsd(totals.value) : unavailable}</p>
          <div className="mkAvailable">
            <dl className="mkBalances">
              <div><dt>Available to trade</dt><dd data-testid="perps-available">{totals ? formatUsd(totals.tradable) : unavailable}</dd></div>
              <div><dt>You can withdraw</dt><dd data-testid="perps-withdrawable">{totals ? formatUsd(totals.withdrawable) : unavailable}</dd></div>
            </dl>
            <span className="mkAvailableActions">
              {!empty && <button type="button" className="appButton" disabled={locked} onClick={() => open("withdraw")}><Minus aria-hidden="true" />Withdraw</button>}
              <button type="button" className={`appButton${empty ? " appButtonPrimary" : ""}`} disabled={Boolean(account?.blocked)} onClick={() => open("add")}><Plus aria-hidden="true" />Add money</button>
            </span>
          </div>
          {account?.blocked && <Notice tone="warning" data-testid="perps-blocked">{account.blocked.message}</Notice>}
          {empty && !account?.blocked && <p className="mxHint" data-testid="perps-empty">Add USDC from your Aura account to start trading. At least ${PERPS_MINIMUM_DEPOSIT}.</p>}
        </>}
    {sheet && <PerpsMoneySheet mode={sheet} account={account} onClose={() => setSheet(null)} />}
  </section>;
}

type ActivityTab = "positions" | "orders" | "history" | "extra";

/** Positions, open orders, and trade history, for every market or one. */
export function PerpsActivity({ account, isPending, isExample, coin, extra }: { account: PerpsAccount | undefined; isPending: boolean; isExample: boolean; coin?: string;
  /** One more tab after History, such as the order book on a market's page on the phone. */
  extra?: { label: string; render: () => React.ReactNode } }) {
  const [tab, setTab] = useState<ActivityTab>("positions");
  const markets = usePerpMarkets();
  const list = markets.data?.markets.status === "observed" ? markets.data.markets.data : [];
  const positions = perpsPositions(account)?.filter((item) => !coin || item.coin === coin) ?? null;
  const allOrders = account?.orders.status === "observed" ? account.orders.data : null;
  const orders = allOrders?.filter((item) => !coin || item.coin === coin) ?? null;
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
            : <ul className="mkRows">{positions.map((position) => <PositionRow key={position.coin} position={position} readOnly={isExample} locked={account?.blocked?.reason === "locked"}
              market={list.find((item) => item.coin === position.coin)} orders={allOrders} />)}</ul>
          : tab === "orders" ? orders === null ? <UnavailableList what="orders" />
            : orders.length === 0 ? <p className="mxHint mkEmptyLine">No open orders.</p>
              : <ul className="mkRows">{orders.map((order) => <OrderRow key={order.oid} order={order} readOnly={isExample} locked={account?.blocked?.reason === "locked"} />)}</ul>
            : fills === null ? <UnavailableList what="history" />
              : fills.length === 0 ? <p className="mxHint mkEmptyLine">No trades yet.</p>
                : <ul className="mkRows">{fills.map((fill) => <li key={fill.tid} className="mkRow mkStatic">
                  <span className="mkRowMain"><strong>{fillDirection(fill.dir)} {perpName(fill.coin)}</strong>
                    <small>{formatToken(fill.size, perpName(fill.coin))} at {formatPrice(fill.px)} · {formatShortDateTime(fill.time)}</small></span>
                  <span className="mkRowEnd">{Number(fill.closedPnl) !== 0 ? <strong className={Number(fill.closedPnl) > 0 ? "mkUp" : undefined}>{formatSignedUsd(Number(fill.closedPnl))}</strong> : null}
                    <small>Fee {formatUsd(fill.fee)}</small></span>
                </li>)}</ul>}
    </div>
  </section>;
}

const UnavailableList = ({ what }: { what: string }) => <p className="mxHint mkEmptyLine"><span className="appUnavailable">Unavailable.</span> Your {what} can&apos;t be loaded from Hyperliquid right now.</p>;

/**
 * One open position, as Hyperliquid and Polymarket show it: market, side and
 * leverage; size and its value; entry and mark price; profit with its return
 * on margin; liquidation price; margin; the take profit and stop loss set on
 * it. TP/SL and Close open their sheets.
 */
function PositionRow({ position, market, orders, readOnly, locked = false }: { position: PerpPosition; market: PerpMarket | undefined; orders: PerpOrder[] | null; readOnly: boolean;
  /** A locked account can't change a position; the account card says why. */
  locked?: boolean }) {
  const { authenticated, login } = useAuth();
  const [sheet, setSheet] = useState<"close" | "tpsl" | null>(null);
  const name = perpName(position.coin);
  const side = positionSide(position.size);
  const pnl = Number(position.unrealizedPnl);
  const triggers = positionTriggers(orders, position.coin);
  const act = (mode: "close" | "tpsl") => !authenticated || readOnly ? login() : setSheet(mode);
  const trigger = (list: PerpOrder[]) => list.length ? list.map((order) => formatPrice(order.triggerPx)).join(", ") : "—";
  return <li className="mkPerpPosition" aria-label={`${name} ${side}`}>
    <div className="mkPerpPositionHead">
      <Link href={perpHref(position.coin)} className="mkPerpPositionName"><strong>{name}</strong></Link>
      <span className={`mkBadge ${side === "long" ? "mkBadgeLong" : ""}`}>{side === "long" ? "Long" : "Short"} {position.leverage.value}x</span>
      <span className="mkBadge">{position.leverage.type === "cross" ? "Cross" : "Isolated"}</span>
      <span className="mkPerpPositionPnl"><strong className={pnl > 0 ? "mkUp" : undefined} data-testid="perps-position-pnl">{formatSignedUsd(pnl)}</strong>
        <small className={pnl > 0 ? "mkUp" : undefined}>{formatSignedPercent(Number(position.returnOnEquity) * 100)}</small></span>
    </div>
    <dl className="mkPerpPositionFacts">
      <div><dt>Size</dt><dd>{formatToken(Math.abs(Number(position.size)), name)}</dd></div>
      <div><dt>Value</dt><dd>{formatUsd(position.positionValue)}</dd></div>
      <div><dt>Entry price</dt><dd>{formatPrice(position.entryPx)}</dd></div>
      <div><dt>Price now</dt><dd>{formatPrice(market?.markPx) ?? <span className="appUnavailable">Unavailable</span>}</dd></div>
      <div><dt>Liquidation price</dt><dd>{formatPrice(position.liquidationPx) ?? "None"}</dd></div>
      <div><dt>Margin</dt><dd>{formatUsd(position.marginUsed)}</dd></div>
      <div><dt>Take profit</dt><dd>{orders === null ? <span className="appUnavailable">Unavailable</span> : trigger(triggers.takeProfit)}</dd></div>
      <div><dt>Stop loss</dt><dd>{orders === null ? <span className="appUnavailable">Unavailable</span> : trigger(triggers.stopLoss)}</dd></div>
    </dl>
    <span className="mkRowActions">
      <button type="button" className="appButton" disabled={locked} onClick={() => act("tpsl")}>Take profit / Stop loss</button>
      <button type="button" className="appButton" disabled={locked} onClick={() => act("close")}>Close</button>
    </span>
    {sheet === "close" && <PositionCloseSheet position={position} market={market} onClose={() => setSheet(null)} />}
    {sheet === "tpsl" && <PositionTpslSheet position={position} market={market} orders={orders} onClose={() => setSheet(null)} />}
  </li>;
}

function OrderRow({ order, readOnly, locked = false }: { order: PerpOrder; readOnly: boolean; locked?: boolean }) {
  const { authenticated, login } = useAuth();
  const perpsAction = usePerpsAction();
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  async function cancel() {
    if (!authenticated || readOnly) return login();
    setState({ busy: true, error: null });
    try {
      await perpsAction("/api/perps/orders/cancel", { coin: order.coin, oid: order.oid });
      await queryClient.invalidateQueries({ queryKey: ["perps-account"] });
      setState({ busy: false, error: null });
    } catch (error) { setState({ busy: false, error: failureMessage(error) }); }
  }
  const name = perpName(order.coin);
  const kind = orderKind(order.orderType);
  // Hyperliquid lists a take profit or stop loss on a whole position with no size of its own.
  const size = Number(order.size) > 0 ? formatToken(order.size, name) : "the whole position";
  const title = kind.kind === "tp" || kind.kind === "sl" ? `${kind.label} on ${name}` : `${kind.label} ${order.side === "buy" ? "buy" : "sell"} ${name}`;
  const detail = order.isTrigger ? `Closes ${size} when the price reaches ${formatPrice(order.triggerPx)}`
    : `${order.side === "buy" ? "Buys" : "Sells"} ${size} at ${formatPrice(order.limitPx)}${order.reduceOnly ? ", only to shrink a position" : ""}`;
  return <li className="mkRow mkStatic">
    <span className="mkRowMain"><strong>{title}</strong>
      <small>{detail} · {formatShortDateTime(order.timestamp)}</small>
      {state.error && <small className="mxFieldError" role="alert">{state.error}</small>}</span>
    <span className="mkRowActions"><button type="button" className="appButton" disabled={state.busy || locked} onClick={() => void cancel()}>{state.busy ? "Cancelling…" : "Cancel"}</button></span>
  </li>;
}
