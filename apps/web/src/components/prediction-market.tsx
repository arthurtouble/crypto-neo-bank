"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/client/auth";
import { formatDateTime, formatShortDateTime, formatToken, formatUsd } from "@/lib/format";
import { formatCents, formatChance, formatCompactUsd, formatSignedUsd, sourceLink } from "@/lib/markets/view";
import { buyPrice, usePredictionHistory, usePredictionMarket, usePredictionsAccount, type PredictionPosition } from "./markets-data";
import { NotAvailableYet, Segmented, SourceLine } from "./markets-parts";
import { GuestBanner } from "./guest-banner";
import { PredictionPositionSheet, PredictionTradeSheet } from "./prediction-sheets";
import { LoadingState, Notice } from "./states";

type Interval = "1d" | "1w" | "1m" | "max";

/**
 * One prediction market: the question, the odds over time, volume, when it
 * ends and who decides it, the customer's position, and a button per outcome
 * with its price.
 */
export function PredictionMarketPage({ id }: { id: string }) {
  const { ready, authenticated, login } = useAuth();
  const params = useSearchParams();
  const view = usePredictionMarket(id);
  const account = usePredictionsAccount();
  const [interval, setRange] = useState<Interval>("1w");
  const requested = params?.get("outcome");
  const [trade, setTrade] = useState<0 | 1 | null>(requested === "0" || requested === "1" ? Number(requested) as 0 | 1 : null);
  const [positionSheet, setPositionSheet] = useState<{ position: PredictionPosition; mode: "sell" | "redeem" } | null>(null);
  const market = view.data?.market;
  const history = usePredictionHistory(market?.yesTokenId ?? null, interval);
  const guest = !ready || !authenticated;
  const held = account.data?.positions.status === "observed" && market ? account.data.positions.data.filter((item) => item.conditionId === market.conditionId) : null;
  const source = sourceLink(market?.resolutionSource);
  const open = (outcome: 0 | 1) => guest ? login() : setTrade(outcome);

  const body = view.switchedOff ? <NotAvailableYet name="Predictions" />
    : view.isPending ? <LoadingState label="Reading this market" />
      : !market ? <Notice tone="warning" role="alert" onRetry={() => void view.refetch()}><span className="appUnavailable">Unavailable.</span> We couldn&apos;t read this market from Polymarket.</Notice>
        : <>
          <section className="mxCard mkOdds" aria-label="Odds">
            <div className="mkCardHead">
              <p className="mkHero"><span data-testid="prediction-chance">{formatChance(market.outcomes[0].price) ?? "—"}</span> <small>chance of {market.outcomes[0].name}</small></p>
              <Segmented label="Chart period" value={interval} onChange={setRange} options={[{ value: "1d", label: "1D" }, { value: "1w", label: "1W" }, { value: "1m", label: "1M" }, { value: "max", label: "All" }]} />
            </div>
            {history.isPending ? <LoadingState label="Reading the odds" />
              : !history.data ? <p className="mxHint"><span className="appUnavailable">Unavailable.</span> We couldn&apos;t read the odds history.</p>
                : <OddsChart points={history.data.history} label={market.outcomes[0].name} />}
            <SourceLine source="polymarket" observedAt={view.data?.observedAt} example={view.isExample} />
          </section>
          <div className="mkTradeBar mkOutcomeBar">
            {market.outcomes.map((outcome, index) => <button type="button" key={outcome.tokenId} className={`appButton appButtonLarge${index === 0 ? " appButtonPrimary" : ""}`}
              disabled={!market.acceptingOrders || market.closed} onClick={() => open(index as 0 | 1)}>
              Buy {outcome.name} {formatCents(buyPrice(market, view.data?.quotes, index as 0 | 1)) ?? ""}</button>)}
          </div>
          {(market.closed || !market.acceptingOrders) && <Notice tone="warning">This market isn&apos;t taking orders.</Notice>}
          <div className="mkColumns">
            <section className="mxCard" aria-labelledby="prediction-position">
              <h2 id="prediction-position">Your position</h2>
              {account.isPending ? <LoadingState label="Reading your positions" />
                : held === null ? <p className="mxHint"><span className="appUnavailable">Unavailable.</span> We couldn&apos;t read your positions from Polymarket.</p>
                  : held.length === 0 ? <p className="mxHint mkEmptyLine">You don&apos;t hold this market.</p>
                    : <ul className="mkRows">{held.map((position) => <li key={position.tokenId} className="mkRow mkStatic mkPosition">
                      <span className="mkRowMain"><strong>{position.outcome}</strong><small>{formatToken(position.size)} shares at {formatCents(position.avgPrice)}</small></span>
                      <span className="mkRowEnd"><strong>{formatUsd(position.value)}</strong><small className={position.pnl > 0 ? "mkUp" : undefined}>{formatSignedUsd(position.pnl)}</small></span>
                      <span className="mkRowActions">{position.redeemable
                        ? <button type="button" className="appButton" onClick={() => guest || account.isExample ? login() : setPositionSheet({ position, mode: "redeem" })}>Collect</button>
                        : <button type="button" className="appButton" disabled={market.closed} onClick={() => guest || account.isExample ? login() : setPositionSheet({ position, mode: "sell" })}>Sell</button>}</span>
                    </li>)}</ul>}
            </section>
            <section className="mxCard" aria-labelledby="prediction-about">
              <h2 id="prediction-about">About</h2>
              <dl className="mxSummary">
                <div><dt>Volume</dt><dd>{formatCompactUsd(market.volume) ?? "Unavailable"}</dd></div>
                <div><dt>24h volume</dt><dd>{formatCompactUsd(market.volume24h) ?? "Unavailable"}</dd></div>
                <div><dt>Ends</dt><dd>{market.endDate ? formatDateTime(market.endDate) : "Not set"}</dd></div>
                <div><dt>Resolves by</dt><dd>{source ? <a href={source.href} target="_blank" rel="noreferrer">{source.host}</a> : market.resolutionSource ?? "Polymarket's rules"}</dd></div>
              </dl>
              <p className="mxHint">Each share pays $1 if its outcome happens and nothing if it doesn&apos;t. Polymarket decides the result after the market ends.</p>
            </section>
          </div>
          {trade !== null && <PredictionTradeSheet market={market} quotes={view.data?.quotes} initialOutcome={trade} account={account.data} onClose={() => setTrade(null)} />}
          {positionSheet && <PredictionPositionSheet market={market} position={positionSheet.position} mode={positionSheet.mode} onClose={() => setPositionSheet(null)} />}
        </>;

  return <div className="mxPage mkPage">
    {guest && <GuestBanner onSignIn={login} ready={ready} />}
    <Link href="/app/markets?view=predictions" className="mkBack"><ChevronLeft aria-hidden="true" />Predictions</Link>
    <header className="mxHead mkMarketHead"><h1>{market?.question ?? "Prediction"}</h1></header>
    {market?.eventTitle && market.eventTitle !== market.question && <p className="mxHint">{market.eventTitle}</p>}
    {body}
    <p className="mxHint mkRisk">Trades happen on Polymarket, from an account your wallet owns. Aura charges no fee. You can lose what you pay.</p>
  </div>;
}

/** The first outcome's chance over time: one line in the accent, a hover readout, and the range in words for screen readers. */
function OddsChart({ points, label }: { points: Array<{ time: number; price: number }>; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="mxHint mkEmptyLine">Not enough trading yet to draw the odds.</p>;
  const width = 600, height = 180, pad = 8;
  const t0 = points[0].time, t1 = points[points.length - 1].time;
  const x = (time: number) => pad + ((time - t0) / Math.max(1, t1 - t0)) * (width - 2 * pad);
  const y = (price: number) => pad + (1 - price) * (height - 2 * pad);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.time).toFixed(1)},${y(point.price).toFixed(1)}`).join(" ");
  const low = Math.min(...points.map((point) => point.price)), high = Math.max(...points.map((point) => point.price));
  const shown = hover === null ? null : points[hover];
  return <figure className="mkChart">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${label} chance from ${formatChance(points[0].price)} to ${formatChance(points[points.length - 1].price)}, between ${formatChance(low)} and ${formatChance(high)}`}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const time = t0 + ((event.clientX - box.left) / box.width) * (t1 - t0);
        let best = 0;
        points.forEach((point, index) => { if (Math.abs(point.time - time) < Math.abs(points[best].time - time)) best = index; });
        setHover(best);
      }} onPointerLeave={() => setHover(null)}>
      {[0.25, 0.5, 0.75].map((level) => <line key={level} className="mkChartGrid" x1={pad} x2={width - pad} y1={y(level)} y2={y(level)} />)}
      <path className="mkChartLine" d={path} vectorEffect="non-scaling-stroke" />
      {shown && <line className="mkChartCursor" x1={x(shown.time)} x2={x(shown.time)} y1={pad} y2={height - pad} vectorEffect="non-scaling-stroke" />}
    </svg>
    <figcaption className="mkChartCaption">{shown ? <><strong>{formatChance(shown.price)}</strong> {formatShortDateTime(shown.time * 1000)}</>
      : <>{formatShortDateTime(t0 * 1000)} to {formatShortDateTime(t1 * 1000)}</>}</figcaption>
  </figure>;
}
