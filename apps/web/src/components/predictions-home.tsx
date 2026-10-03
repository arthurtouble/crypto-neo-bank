"use client";

import Link from "next/link";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/client/auth";
import { formatShortDateTime, formatTime, formatToken, formatUsd } from "@/lib/format";
import { formatChance, formatCompactUsd, formatPrice, formatSignedUsd, PREDICTION_CATEGORIES, type PredictionCategory } from "@/lib/markets/view";
import { usePredictionEvents, usePredictionsAccount, useUpOrDown, type PolymarketEvent, type PredictionPosition, type PredictionsAccount } from "./markets-data";
import { NotAvailableYet, SourceLine } from "./markets-parts";
import { PredictionsMoneySheet } from "./prediction-sheets";
import { LoadingState, Notice } from "./states";

const marketHref = (id: string, outcome?: 0 | 1) => `/app/markets/predictions/${encodeURIComponent(id)}${outcome === undefined ? "" : `?outcome=${outcome}`}`;

/**
 * Predictions home: the predictions account and its positions, then events by
 * category with each outcome's chance. Sports are never listed.
 */
export function PredictionsHome() {
  const [category, setCategory] = useState<PredictionCategory>("all");
  const tag = PREDICTION_CATEGORIES.find((item) => item.key === category)?.tag ?? null;
  const upOrDown = category === "up-or-down";
  const events = usePredictionEvents(upOrDown ? null : tag);
  const shortTerm = useUpOrDown(upOrDown);
  const account = usePredictionsAccount();
  const list = upOrDown ? shortTerm : events;

  if (events.switchedOff || account.switchedOff || shortTerm.switchedOff) return <NotAvailableYet name="Predictions" />;
  return <div className="mkSection">
    <PredictionsAccountCard account={account.data} isExample={account.isExample} isPending={account.isPending} failed={Boolean(account.error)} onRetry={() => void account.refetch()} />
    <section className="mkEvents" aria-labelledby="prediction-events">
      <h2 id="prediction-events" className="srOnly">Prediction markets</h2>
      <div className="mkChips" role="group" aria-label="Categories">
        {PREDICTION_CATEGORIES.map((item) => <button type="button" key={item.key} className="mkChip" aria-pressed={category === item.key} onClick={() => setCategory(item.key)}>{item.label}</button>)}
      </div>
      {list.isPending ? <LoadingState label="Reading Polymarket's markets" />
        : list.error || !list.data ? <Notice tone="warning" role="alert" onRetry={() => void list.refetch()} data-testid="predictions-unavailable">
          <span className="appUnavailable">Unavailable.</span> We couldn&apos;t read Polymarket&apos;s markets just now.</Notice>
          : list.data.events.length === 0 ? <p className="mxHint">No open markets here right now.</p>
            : <div className="mkEventGrid">{list.data.events.map((event) => <EventCard key={event.id} event={event} />)}</div>}
      {list.data && <SourceLine source="polymarket" observedAt={null} example={list.isExample} />}
    </section>
  </div>;
}

function EventCard({ event }: { event: PolymarketEvent }) {
  const [first] = event.markets;
  const single = event.markets.length === 1;
  return <article className="mxCard mkEvent" aria-label={event.title}>
    <div className="mkEventHead">
      <h3>{single ? <Link href={marketHref(first.id)}>{event.title}</Link> : event.title}</h3>
      {event.upOrDown?.window && <span className="mkBadge">{event.upOrDown.window}</span>}
    </div>
    {single ? <div className="mkOutcomeButtons">
      {first.outcomes.map((outcome, index) => <Link key={outcome.tokenId} className="mkOutcome" href={marketHref(first.id, index as 0 | 1)}>
        <span>{outcome.name}</span><strong>{formatChance(outcome.price) ?? "—"}</strong></Link>)}
    </div> : <ul className="mkEventMarkets">
      {[...event.markets].sort((a, b) => (b.outcomes[0].price ?? 0) - (a.outcomes[0].price ?? 0)).slice(0, 3).map((market) => <li key={market.id}>
        <Link href={marketHref(market.id)}><span>{market.question}</span><strong>{formatChance(market.outcomes[0].price) ?? "—"}</strong></Link></li>)}
      {event.markets.length > 3 && <li className="mxHint">{event.markets.length - 3} more</li>}
    </ul>}
    <p className="mkEventFoot">
      {event.upOrDown ? <>{event.upOrDown.priceToBeat !== null ? `Price to beat ${formatPrice(event.upOrDown.priceToBeat)} · ` : ""}{event.endDate ? `Ends ${formatTime(event.endDate)}` : ""}</>
        : <>{formatCompactUsd(event.volume) ?? "—"} vol{event.endDate ? ` · Ends ${formatShortDateTime(event.endDate)}` : ""}</>}
    </p>
  </article>;
}

function PredictionsAccountCard({ account, isExample, isPending, failed, onRetry }: { account: PredictionsAccount | undefined; isExample: boolean; isPending: boolean; failed: boolean; onRetry: () => void }) {
  const { login } = useAuth();
  const [sheet, setSheet] = useState<"add" | "withdraw" | null>(null);
  const balance = account?.balance.status === "observed" ? Number(account.balance.data.amount) : null;
  const positions = account?.positions.status === "observed" ? account.positions.data : null;
  const positionsValue = positions?.reduce((sum, item) => sum + item.value, 0) ?? null;
  const open = (mode: "add" | "withdraw") => isExample ? login() : setSheet(mode);
  return <section className="mxCard mkAccount" aria-labelledby="predictions-account">
    <div className="mkCardHead"><h2 id="predictions-account">Predictions account</h2>
      {account && <SourceLine source="polymarket" observedAt={account.balance.observedAt} example={isExample} />}</div>
    {isPending ? <LoadingState label="Reading your predictions account" />
      : failed && !account ? <Notice tone="warning" role="alert" onRetry={onRetry}><span className="appUnavailable">Unavailable.</span> We couldn&apos;t read your predictions account.</Notice>
        : <>
          <p className="mkHero" data-testid="predictions-value">{balance !== null && positionsValue !== null ? formatUsd(balance + positionsValue) : <span className="appUnavailable">Unavailable</span>}</p>
          <div className="mkAvailable">
            <span><small>Cash</small><strong data-testid="predictions-cash">{balance !== null ? formatUsd(balance) : <span className="appUnavailable">Unavailable</span>}</strong></span>
            <span className="mkAvailableActions">
              <button type="button" className="appButton" onClick={() => open("withdraw")}><Minus aria-hidden="true" />Withdraw</button>
              <button type="button" className="appButton" onClick={() => open("add")}><Plus aria-hidden="true" />Add money</button>
            </span>
          </div>
          <h3 className="mkSubhead">Your positions</h3>
          {positions === null ? <p className="mxHint"><span className="appUnavailable">Unavailable.</span> We couldn&apos;t read your positions from Polymarket.</p>
            : positions.length === 0 ? <p className="mxHint mkEmptyLine">No positions yet. Pick a market below.</p>
              : <ul className="mkRows" aria-label="Your prediction positions">{positions.map((position) => <PositionRow key={position.tokenId} position={position} />)}</ul>}
        </>}
    {sheet && <PredictionsMoneySheet mode={sheet} account={account} onClose={() => setSheet(null)} />}
  </section>;
}

function PositionRow({ position }: { position: PredictionPosition }) {
  const content = <>
    <span className="mkRowMain"><strong>{position.title}</strong>
      <small>{position.outcome} · {formatToken(position.size)} shares at {formatChance(position.avgPrice)}{position.redeemable ? " · Ready to collect" : ""}</small></span>
    <span className="mkRowEnd"><strong>{formatUsd(position.value)}</strong><small className={position.pnl > 0 ? "mkUp" : undefined}>{formatSignedUsd(position.pnl)}</small></span>
  </>;
  // Polymarket's positions name the market by slug; its page reads the market by that.
  return <li>{position.slug ? <Link className="mkRow" href={marketHref(position.slug)}>{content}</Link> : <span className="mkRow mkStatic">{content}</span>}</li>;
}
