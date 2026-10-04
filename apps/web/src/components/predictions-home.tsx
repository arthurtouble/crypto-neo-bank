"use client";

import Link from "next/link";
import { Minus, Plus, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/client/auth";
import { useApi } from "@/lib/client/api";
import { formatShortDateTime, formatToken, formatUsd } from "@/lib/format";
import { formatCents, formatChance, formatCompactUsd, formatPrice, formatSignedUsd, PREDICTION_CATEGORIES, type PredictionCategory } from "@/lib/markets/view";
import { formatCountdown, formatWindow, UP_OR_DOWN_WINDOWS } from "@/lib/markets/predictions-view";
import { usePredictionsAccount, type PolymarketEvent, type PredictionOrder, type PredictionPosition, type PredictionsAccount } from "./markets-data";
import { ListTabs, NotAvailableYet, SourceLine } from "./markets-parts";
import { PredictionPositionSheet, PredictionsMoneySheet, PredictionsSetupSheet, positionState } from "./prediction-sheets";
import { predictionErrorMessage, predictionHref, unavailableReason, useNow, usePredictionEventList } from "./predictions-data";
import { LoadingState, Notice } from "./states";

/**
 * Predictions home: the predictions account (cash, positions, open orders),
 * then open markets by category or search, each with its chances, and the
 * short crypto Up or Down markets by window with their time left. Sports and
 * esports are never listed.
 */
export function PredictionsHome() {
  const [category, setCategory] = useState<PredictionCategory>("all");
  const [search, setSearch] = useState("");
  const [length, setLength] = useState<string | null>(null);
  const tag = PREDICTION_CATEGORIES.find((item) => item.key === category)?.tag ?? null;
  const upOrDown = category === "up-or-down";
  const list = usePredictionEventList({ tag, search, upOrDown, window: length });
  const account = usePredictionsAccount();

  if (list.switchedOff || account.switchedOff) return <NotAvailableYet name="Predictions" />;
  return <div className="mkSection">
    <PredictionsAccountCard account={account.data} isExample={account.isExample} isPending={account.isPending} failed={Boolean(account.error)} onRetry={() => void account.refetch()} />
    <section className="pdEvents" aria-labelledby="prediction-events">
      <h2 id="prediction-events" className="srOnly">Prediction markets</h2>
      <div className="pdFilters">
        <div className="pdChips" role="group" aria-label="Categories">
          {PREDICTION_CATEGORIES.map((item) => <button type="button" key={item.key} className="mkChip" aria-pressed={category === item.key} onClick={() => setCategory(item.key)}>{item.label}</button>)}
        </div>
        {upOrDown ? <div className="pdChips" role="group" aria-label="Window">
          <button type="button" className="mkChip" aria-pressed={length === null} onClick={() => setLength(null)}>Any length</button>
          {UP_OR_DOWN_WINDOWS.map((item) => <button type="button" key={item} className="mkChip" aria-pressed={length === item} onClick={() => setLength(item)}>{formatWindow(item)}</button>)}
        </div> : <label className="mkSearch pdSearch"><Search aria-hidden="true" size={16} />
          <input type="search" placeholder="Search markets" aria-label="Search markets" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} /></label>}
      </div>
      {list.isPending ? <LoadingState label="Loading Polymarket's markets" />
        : list.error || !list.events ? <Notice tone="warning" role="alert" onRetry={list.refetch} data-testid="predictions-unavailable">
          Polymarket&apos;s markets can&apos;t be loaded right now.</Notice>
          : list.events.length === 0 ? <p className="mxHint mkEmptyLine">{search.trim() && !upOrDown ? `No open markets match "${search.trim()}".` : "No open markets here right now."}</p>
            : <div className="pdEventGrid">{list.events.map((event) => <EventCard key={event.id} event={event} />)}</div>}
      {list.hasMore && <button type="button" className="appButton pdMore" disabled={list.loadingMore} onClick={list.loadMore}>{list.loadingMore ? "Loading…" : "Show more"}</button>}
      {list.events && <SourceLine source="polymarket" observedAt={null} example={list.isExample} />}
    </section>
  </div>;
}

/** Time left on a short market, counting down each second. */
function EndsIn({ endDate }: { endDate: string }) {
  const now = useNow();
  const left = Date.parse(endDate) - now;
  return <>{left > 0 ? `Ends in ${formatCountdown(left)}` : "Ended"}</>;
}

function EventCard({ event }: { event: PolymarketEvent }) {
  const [first] = event.markets;
  const single = event.markets.length === 1;
  const span = formatWindow(event.upOrDown?.window);
  return <article className="mxCard pdEvent" aria-label={event.title}>
    <div className="pdEventHead">
      {/* Polymarket's own icon, from its image host (img-src allows https). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {event.image && <img className="pdEventIcon" src={event.image} alt="" width={40} height={40} loading="lazy" />}
      <h3>{single ? <Link href={predictionHref(first.id)}>{event.title}</Link> : event.title}</h3>
      {span && <span className="mkBadge">{span}</span>}
    </div>
    {single ? <div className="pdOutcomeLinks">
      {first.outcomes.map((outcome, index) => <Link key={outcome.tokenId} className={`pdOutcomeLink ${index === 0 ? "is-first" : "is-second"}`} href={predictionHref(first.id, index as 0 | 1)}>
        <span>{outcome.name}</span><strong>{formatChance(outcome.price) ?? "—"}</strong></Link>)}
    </div> : <ul className="pdEventMarkets" aria-label="Outcomes">
      {[...event.markets].sort((a, b) => (b.outcomes[0].price ?? 0) - (a.outcomes[0].price ?? 0)).map((market) => <li key={market.id}>
        <Link href={predictionHref(market.id)}><span>{market.question}</span><strong>{formatChance(market.outcomes[0].price) ?? "—"}</strong></Link></li>)}
    </ul>}
    <p className="pdEventFoot">
      {event.upOrDown ? <>{event.upOrDown.priceToBeat !== null ? `Starting price ${formatPrice(event.upOrDown.priceToBeat)} · ` : ""}{event.endDate ? <EndsIn endDate={event.endDate} /> : null}</>
        : <>{formatCompactUsd(event.volume) ?? "—"} volume{event.endDate ? ` · Ends ${formatShortDateTime(event.endDate)}` : ""}</>}
    </p>
  </article>;
}

function PredictionsAccountCard({ account, isExample, isPending, failed, onRetry }: { account: PredictionsAccount | undefined; isExample: boolean; isPending: boolean; failed: boolean; onRetry: () => void }) {
  const { login } = useAuth();
  const [sheet, setSheet] = useState<"add" | "withdraw" | "setup" | null>(null);
  const [tab, setTab] = useState<"positions" | "orders">("positions");
  const [positionSheet, setPositionSheet] = useState<{ position: PredictionPosition; mode: "sell" | "redeem" } | null>(null);
  const balance = account?.balance.status === "observed" ? Number(account.balance.data.amount) : null;
  const positions = account?.positions.status === "observed" ? account.positions.data : null;
  const orders = account?.orders?.status === "observed" ? account.orders.data : null;
  const positionsValue = positions?.reduce((sum, item) => sum + item.value, 0) ?? null;
  const pending = account?.connection?.status === "pending";
  // A customer who hasn't set up predictions has nothing to withdraw, sell, or cancel: one line and Deposit, so the markets come up sooner.
  const fresh = !isExample && !account?.connection && balance === 0 && positions?.length === 0;
  const open = (mode: "add" | "withdraw" | "setup") => isExample ? login() : setSheet(mode);
  const act = (position: PredictionPosition, mode: "sell" | "redeem") => isExample ? login() : setPositionSheet({ position, mode });
  const depositButton = <button type="button" className="appButton" onClick={() => open("add")}><Plus aria-hidden="true" />Deposit</button>;
  return <section className="mxCard mkAccount" aria-labelledby="predictions-account">
    <div className="mkCardHead"><h2 id="predictions-account">Predictions account</h2>
      {account && <SourceLine source="polymarket" observedAt={account.balance.observedAt} example={isExample} />}</div>
    {isPending ? <LoadingState label="Loading your predictions account" />
      : failed && !account ? <Notice tone="warning" role="alert" onRetry={onRetry}>Your predictions account can&apos;t be loaded right now.</Notice>
        : fresh ? <div className="pdFresh" data-testid="predictions-not-set-up">
          <p className="mxHint">Deposit from your USDC, or pick a market and buy. Your first deposit or buy sets up your predictions account, once.</p>
          {depositButton}
        </div>
        : <>
          <p className="mkHero" data-testid="predictions-value">{balance !== null && positionsValue !== null ? formatUsd(balance + positionsValue) : <span className="appUnavailable">Unavailable</span>}</p>
          <div className="mkAvailable">
            <span><small>Cash</small><strong data-testid="predictions-cash">{balance !== null ? formatUsd(balance) : <span className="appUnavailable">Unavailable</span>}</strong></span>
            <span className="mkAvailableActions">
              <button type="button" className="appButton" onClick={() => open("withdraw")}><Minus aria-hidden="true" />Withdraw</button>
              {depositButton}
            </span>
          </div>
          {account?.balance.status === "unavailable" && <p className="mxHint" data-testid="predictions-cash-unavailable">{unavailableReason("cash")} Try again in a minute.</p>}
          {pending && <Notice tone="warning" data-testid="predictions-setup-pending">Setting up your predictions account isn&apos;t finished.{" "}
            <button type="button" className="appTextButton mxInlineButton" onClick={() => open("setup")}>Finish setup</button></Notice>}
          <ListTabs label="Your predictions" value={tab} onChange={setTab}
            options={[{ value: "positions", label: "Positions", count: positions?.length }, { value: "orders", label: "Open orders", count: orders?.length }]} />
          {tab === "positions" ? positions === null
            ? <p className="mxHint"><span className="appUnavailable">Unavailable.</span> {unavailableReason("positions")}</p>
            : positions.length === 0 ? <p className="mxHint mkEmptyLine">No positions yet. Pick a market below.</p>
              : <ul className="mkRows" aria-label="Your prediction positions">{positions.map((position) => <PositionRow key={position.tokenId} position={position} onAction={act} />)}</ul>
            : <OpenOrders account={account} orders={orders} isExample={isExample} />}
        </>}
    {sheet === "setup" ? <PredictionsSetupSheet onClose={() => setSheet(null)} />
      : sheet && <PredictionsMoneySheet mode={sheet} account={account} onClose={() => setSheet(null)} />}
    {positionSheet && <PredictionPositionSheet position={positionSheet.position} mode={positionSheet.mode} onClose={() => setPositionSheet(null)} />}
  </section>;
}

function PositionRow({ position, onAction }: { position: PredictionPosition; onAction: (position: PredictionPosition, mode: "sell" | "redeem") => void }) {
  const state = positionState(position);
  const main = <>
    <span className="mkRowMain"><strong>{position.title}</strong>
      <small>{position.outcome} · {formatToken(position.size)} shares at {formatCents(position.avgPrice)}{state === "collect" ? " · Won" : state === "lost" ? " · Lost" : ""}</small></span>
    <span className="mkRowEnd"><strong>{formatUsd(position.value)}</strong><small className={position.pnl > 0 ? "mkUp" : undefined}>{formatSignedUsd(position.pnl)}</small></span>
  </>;
  // Polymarket's positions name the market by slug; its page reads the market by that.
  return <li className="pdPositionRow" aria-label={`${position.title}, ${position.outcome}`}>
    {position.slug ? <Link className="mkRow" href={predictionHref(position.slug)}>{main}</Link> : <span className="mkRow mkStatic">{main}</span>}
    {state === "collect" ? <button type="button" className="appButton appButtonPrimary" onClick={() => onAction(position, "redeem")}>Collect</button>
      : state === "open" && position.slug ? <button type="button" className="appButton" onClick={() => onAction(position, "sell")}>Sell</button> : null}
  </li>;
}

/** Orders resting on Polymarket's book (placed there or elsewhere), each with Cancel. Aura's own buys and sales fill at once. */
function OpenOrders({ account, orders, isExample }: { account: PredictionsAccount | undefined; orders: PredictionOrder[] | null; isExample: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { login } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!account?.connection || account.connection.status !== "ready") return <p className="mxHint mkEmptyLine">No open orders.</p>;
  if (orders === null) return <p className="mxHint"><span className="appUnavailable">Unavailable.</span> {unavailableReason("orders")}</p>;
  if (orders.length === 0) return <p className="mxHint mkEmptyLine">No open orders.</p>;
  async function cancel(order: PredictionOrder) {
    if (isExample) { login(); return; }
    setBusy(order.id); setError(null);
    try { await api("/api/predictions/orders/cancel", { method: "POST", json: { orderId: order.id } }); }
    catch (cause) { setError(predictionErrorMessage(cause)); }
    finally { setBusy(null); void queryClient.invalidateQueries({ queryKey: ["predictions-account"] }); }
  }
  return <>
    {error && <Notice tone="error" role="alert">{error}</Notice>}
    <ul className="mkRows" aria-label="Your open orders">{orders.map((order) => <li key={order.id} className="mkRow mkStatic">
      <span className="mkRowMain"><strong>{order.side === "BUY" ? "Buy" : "Sell"} {order.outcome || "shares"} at {formatCents(order.price)}</strong>
        <small>{formatToken(order.sizeMatched)} of {formatToken(order.originalSize)} shares filled</small></span>
      <button type="button" className="appButton" disabled={busy === order.id} onClick={() => void cancel(order)}>{busy === order.id ? "Cancelling…" : "Cancel"}</button>
    </li>)}</ul>
  </>;
}
