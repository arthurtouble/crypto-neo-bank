"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/client/auth";
import { exampleUpOrDownEvents } from "@/lib/example/markets";
import { formatDateTime, formatTime, formatToken, formatUsd } from "@/lib/format";
import { formatCents, formatChance, formatCompactUsd, formatSignedUsd, sourceLink } from "@/lib/markets/view";
import { chanceThen, formatAssetPrice, formatCountdown, formatWindow, priceToBeatFrom, upOrDownInfo, windowPhase, winningOutcome, type UpOrDownInfo } from "@/lib/markets/predictions-view";
import { buyPrice, usePredictionHistory, usePredictionMarket, usePredictionsAccount, type MarketQuery, type PolymarketMarket, type PredictionPosition } from "./markets-data";
import { NotAvailableYet, Segmented, SourceLine, useIsPhone } from "./markets-parts";
import { GuestBanner } from "./guest-banner";
import { LivePriceChart, OddsChart } from "./prediction-chart";
import { PredictionPositionSheet, positionState } from "./prediction-sheets";
import { PredictionTradeForm, PredictionTradeSheet, type TradeSide } from "./prediction-trade";
import { PREDICTIONS_HREF, useNow, usePriceStream, useUpOrDownEvent, type PredictionMarketDetail } from "./predictions-data";
import { LoadingState, Notice } from "./states";

type Range = "1h" | "6h" | "1d" | "1w" | "1m" | "max";
const RANGES: Array<{ value: Range; label: string }> = [
  { value: "1h", label: "1H" }, { value: "6h", label: "6H" }, { value: "1d", label: "1D" }, { value: "1w", label: "1W" }, { value: "1m", label: "1M" }, { value: "max", label: "All" }
];

/**
 * One prediction market, laid out like Polymarket's. Desktop: the question,
 * the odds chart (or, for a crypto Up or Down market, the live price against
 * the price to beat with the time left), the customer's position, and the
 * rules on the left; the order panel on the right, always open. Phone: one
 * column, with Buy buttons under the chart that open the order form in a
 * bottom sheet.
 */
export function PredictionMarketPage({ id }: { id: string }) {
  const { ready, authenticated, login } = useAuth();
  const params = useSearchParams();
  const phone = useIsPhone();
  const view = usePredictionMarket(id) as MarketQuery<PredictionMarketDetail>;
  const account = usePredictionsAccount();
  const requested = params?.get("outcome");
  const initial = requested === "1" ? 1 : 0;
  const [outcome, setOutcome] = useState<0 | 1>(initial);
  const [side, setSide] = useState<TradeSide>("buy");
  const [sheet, setSheet] = useState<{ outcome: 0 | 1; side: TradeSide } | null>(requested === "0" || requested === "1" ? { outcome: initial, side: "buy" } : null);
  const [positionSheet, setPositionSheet] = useState<{ position: PredictionPosition; mode: "sell" | "redeem" } | null>(null);
  const market = view.data?.market;
  const info = market ? upOrDownInfo(market) : null;
  const guest = !ready || !authenticated;
  const held = account.data?.positions.status === "observed" && market ? account.data.positions.data.filter((item) => item.conditionId === market.conditionId) : null;
  const openSheet = (next: { outcome: 0 | 1; side: TradeSide }) => guest || account.isExample ? login() : setSheet(next);

  const body = view.switchedOff ? <NotAvailableYet name="Predictions" />
    : view.isPending ? <LoadingState label="Loading this market" />
      : !market ? <Notice tone="warning" role="alert" onRetry={() => void view.refetch()}>This market can&apos;t be loaded from Polymarket right now.</Notice>
        : <div className="pdLayout">
          <div className="pdMain">
            {info ? <UpOrDownBoard market={market} info={info} published={view.data?.upOrDown?.priceToBeat ?? null} isExample={view.isExample} />
              : <OddsCard market={market} observedAt={view.data?.observedAt} isExample={view.isExample} />}
            {phone && !market.closed && market.acceptingOrders && <div className="mkTradeBar pdTradeBar">
              {market.outcomes.map((item, index) => <button type="button" key={item.tokenId} className={`appButton appButtonLarge pdBuy ${index === 0 ? "is-first" : "is-second"}`}
                onClick={() => openSheet({ outcome: index as 0 | 1, side: "buy" })}>Buy {item.name} {formatCents(buyPrice(market, view.data?.quotes, index as 0 | 1)) ?? ""}</button>)}
            </div>}
            {phone && (market.closed || !market.acceptingOrders) && <section className="mxCard"><PredictionTradeForm market={market} quotes={view.data?.quotes} account={account.data}
              outcome={outcome} onOutcome={setOutcome} side={side} onSide={setSide} held={held} guest={guest} onSignIn={login} /></section>}
            <PositionCard market={market} held={held} isPending={account.isPending} onAction={(position, mode) => guest || account.isExample ? login() : setPositionSheet({ position, mode })}
              onSell={(position) => { const next = position.outcomeIndex === 1 ? 1 : 0; if (phone) openSheet({ outcome: next, side: "sell" }); else { setOutcome(next); setSide("sell"); } }} />
            <AboutCard market={market} info={info} />
          </div>
          {!phone && <aside className="mxCard mkOrderPanel pdPanel" aria-label="Trade">
            <PredictionTradeForm market={market} quotes={view.data?.quotes} account={account.data} outcome={outcome} onOutcome={setOutcome} side={side} onSide={setSide}
              held={held} guest={guest || account.isExample} onSignIn={login} />
          </aside>}
          {phone && sheet && <PredictionTradeSheet market={market} quotes={view.data?.quotes} account={account.data} initialOutcome={sheet.outcome} initialSide={sheet.side}
            held={held} onClose={() => setSheet(null)} />}
          {positionSheet && <PredictionPositionSheet market={market} quotes={view.data?.quotes} position={positionSheet.position} mode={positionSheet.mode} onClose={() => setPositionSheet(null)} />}
        </div>;

  return <div className="mxPage mkPage pdPage">
    {guest && <GuestBanner onSignIn={login} ready={ready} />}
    <Link href={PREDICTIONS_HREF} className="pdBack"><ChevronLeft aria-hidden="true" />Predictions</Link>
    <MarketHeader market={market} info={info} />
    {body}
    <p className="mxHint mkRisk">Trades happen on Polymarket, from an account your wallet owns. Aura charges no fee. You can lose what you pay.</p>
  </div>;
}

/** The question, with the event it belongs to, its volume, and when it ends, as Polymarket heads a market. */
function MarketHeader({ market, info }: { market: PolymarketMarket | undefined; info: UpOrDownInfo | null }) {
  const span = formatWindow(info?.window);
  return <header className="pdHead">
    {/* Polymarket's own icon, from its image host (img-src allows https). */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {market?.image && <img className="pdIcon" src={market.image} alt="" width={48} height={48} />}
    <div className="pdHeadText">
      {market?.eventTitle && market.eventTitle !== market.question && <p className="pdEventTitle">{market.eventTitle}</p>}
      <h1>{market?.question ?? "Prediction"}</h1>
      {market && <p className="pdMeta">
        {span && <span className="mkBadge">{span}</span>}
        <span>{formatCompactUsd(market.volume) ?? "—"} volume</span>
        {market.endDate && <span>{market.closed ? "Ended" : "Ends"} {formatDateTime(market.endDate)}</span>}
      </p>}
    </div>
  </header>;
}

/** The first outcome's chance now and over a range, as Polymarket charts it. */
function OddsCard({ market, observedAt, isExample }: { market: PolymarketMarket; observedAt: string | undefined; isExample: boolean }) {
  const [range, setRange] = useState<Range>("1w");
  const history = usePredictionHistory(market.yesTokenId, range);
  const then = history.data ? chanceThen(history.data.history, range) : null;
  const winner = winningOutcome(market);
  return <section className="mxCard pdOdds" aria-label="Chance">
    <div className="pdOddsHead">
      <p className="pdChance">{winner !== null ? <strong>{market.outcomes[winner].name} won</strong>
        : <><strong data-testid="prediction-chance">{formatChance(market.outcomes[0].price) ?? "—"}</strong> <span>chance of {market.outcomes[0].name}</span></>}</p>
      {then && winner === null && <p className="pdThen">{then}</p>}
    </div>
    {history.isPending ? <LoadingState label="Loading the chart" />
      : !history.data ? <p className="mxHint" data-testid="prediction-history-unavailable"><span className="appUnavailable">Unavailable.</span> The chart can&apos;t be loaded right now.</p>
        : <OddsChart points={history.data.history} label={market.outcomes[0].name} />}
    <div className="pdChartFoot">
      <Segmented label="Chart period" value={range} onChange={setRange} className="pdRanges" options={RANGES} />
      <SourceLine source="polymarket" observedAt={observedAt} example={isExample} />
    </div>
  </section>;
}

/**
 * A crypto Up or Down market, as Polymarket shows it: the price to beat, the
 * live price and how far it is above or below, the time left, and a chart of
 * every tick streamed from Polymarket's live Chainlink prices.
 */
function UpOrDownBoard({ market, info, published, isExample }: { market: PolymarketMarket; info: UpOrDownInfo; published: number | null; isExample: boolean }) {
  const now = useNow();
  const event = useUpOrDownEvent(market.id, !isExample);
  const asset = info.asset ?? "The price";
  const start = market.startTime ? Date.parse(market.startTime) : Number.NaN;
  const examplePrice = isExample ? (published ?? event?.upOrDown?.priceToBeat ?? exampleBeat(market)) : null;
  const stream = usePriceStream(info.symbol, { since: Number.isFinite(start) ? Math.min(start, now) - 60_000 : now - 15 * 60_000, example: examplePrice });
  const beat = priceToBeatFrom(published ?? event?.upOrDown?.priceToBeat ?? (isExample ? examplePrice : null), stream.ticks, market.startTime);
  const phase = windowPhase(market.startTime, market.endDate, now);
  const last = stream.ticks.at(-1) ?? null;
  const current = stream.status === "live" && last ? last.price : null;
  const difference = current !== null && beat ? current - beat.price : null;
  const end = market.endDate ? Date.parse(market.endDate) : Number.NaN;
  const winner = winningOutcome(market);
  return <section className="mxCard pdLive" aria-label="Live price">
    <dl className="pdLiveStats">
      <div><dt>Starting price</dt><dd data-testid="prediction-price-to-beat">{beat ? formatAssetPrice(beat.price)
        : phase === "before" ? <span className="pdMuted">Set when it starts</span> : <span className="appUnavailable">Unavailable</span>}</dd></div>
      <div><dt>Current price</dt><dd data-testid="prediction-current-price">{current !== null ? <>{formatAssetPrice(current)}{difference !== null &&
        <small className={difference >= 0 ? "mkUp" : "mkFlat"}> {difference >= 0 ? "▲" : "▼"} {formatSignedUsd(difference).replace(/^[+−]/, "")}</small>}</>
        : stream.status === "connecting" ? <span className="pdMuted">Loading…</span> : <span className="appUnavailable">Unavailable</span>}</dd></div>
      <div className="pdCountdown"><dt>{phase === "before" ? "Starts in" : phase === "ended" ? "Ended" : "Time left"}</dt>
        <dd data-testid="prediction-time-left">{phase === "before" ? formatCountdown(start - now)
          : phase === "ended" ? (winner !== null ? `${market.outcomes[winner].name} won` : "Deciding…")
            : Number.isFinite(end) ? formatCountdown(end - now) : "—"}</dd></div>
    </dl>
    {stream.ticks.length >= 2 ? <LivePriceChart ticks={stream.ticks} priceToBeat={beat?.price ?? null} asset={asset} />
      : stream.status === "unavailable" || !info.symbol ? <p className="mxHint pdChartEmpty" data-testid="prediction-live-unavailable"><span className="appUnavailable">Unavailable.</span> The live {info.asset ?? ""} price can&apos;t be loaded right now.</p>
        : <LoadingState label={`Loading the live ${info.asset ?? ""} price`} />}
    <small className="mkSource">{isExample ? "Example data, shaped like Polymarket's"
      : stream.lastAt ? `Live from Chainlink, through Polymarket, at ${new Date(stream.lastAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
        : "Live from Chainlink, through Polymarket"}
      {beat?.from === "stream" && market.startTime ? ` · Starting price is Chainlink's price at ${formatTime(market.startTime)}` : ""}</small>
  </section>;
}

/** A guest's example Up or Down market: the example event's price to beat. */
const exampleBeat = (market: PolymarketMarket) =>
  exampleUpOrDownEvents.find((event) => event.markets.some((item) => item.id === market.id))?.upOrDown?.priceToBeat ?? 100;

/** The customer's shares in this market: each outcome held, its value and profit, and Sell, or Collect once it has won. */
function PositionCard({ market, held, isPending, onAction, onSell }: {
  market: PolymarketMarket; held: PredictionPosition[] | null; isPending: boolean;
  onAction: (position: PredictionPosition, mode: "redeem") => void; onSell: (position: PredictionPosition) => void;
}) {
  return <section className="mxCard" aria-labelledby="prediction-position">
    <h2 id="prediction-position">Your position</h2>
    {isPending ? <LoadingState label="Loading your positions" />
      : held === null ? <p className="mxHint"><span className="appUnavailable">Unavailable.</span> Your positions can&apos;t be loaded from Polymarket right now.</p>
        : held.length === 0 ? <p className="mxHint mkEmptyLine">You don&apos;t hold any shares in this market.</p>
          : <ul className="mkRows">{held.map((position) => {
            const state = positionState(position);
            return <li key={position.tokenId} className="mkRow mkStatic mkPosition" aria-label={`${position.outcome} position`}>
              <span className="mkRowMain"><strong>{position.outcome}</strong>
                <small>{formatToken(position.size)} shares at {formatCents(position.avgPrice)}{state === "collect" ? " · Won" : state === "lost" ? " · Lost" : ` · now ${formatCents(position.currentPrice)}`}</small></span>
              <span className="mkRowEnd"><strong>{formatUsd(position.value)}</strong><small className={position.pnl > 0 ? "mkUp" : undefined}>{formatSignedUsd(position.pnl)}</small></span>
              <span className="mkRowActions">{state === "collect"
                ? <button type="button" className="appButton appButtonPrimary" onClick={() => onAction(position, "redeem")}>Collect {formatUsd(position.value)}</button>
                : state === "open" ? <button type="button" className="appButton" disabled={market.closed || !market.acceptingOrders} onClick={() => onSell(position)}>Sell</button> : null}</span>
            </li>;
          })}</ul>}
  </section>;
}

/** What decides the market and the numbers behind it. */
function AboutCard({ market, info }: { market: PolymarketMarket; info: UpOrDownInfo | null }) {
  const source = sourceLink(market.resolutionSource);
  const [first, second] = market.outcomes;
  return <section className="mxCard" aria-labelledby="prediction-about">
    <h2 id="prediction-about">About</h2>
    <p className="pdRules">{info
      ? `${first.name} wins if ${info.asset ?? "the asset"}'s price for this window, as Chainlink reports it, ends at or above the starting price. Otherwise ${second.name} wins.`
      : `Each ${first.name} share pays $1 if the answer is ${first.name}, and nothing if it isn't. ${second.name} shares pay the other way.`}
      {" "}Polymarket decides the result after the market ends, by its rules and the source below.</p>
    <dl className="mxSummary">
      <div><dt>Volume</dt><dd>{formatCompactUsd(market.volume) ?? "Unavailable"}</dd></div>
      <div><dt>24h volume</dt><dd>{formatCompactUsd(market.volume24h) ?? "Unavailable"}</dd></div>
      {market.startTime && info && <div><dt>Starts</dt><dd>{formatDateTime(market.startTime)}</dd></div>}
      <div><dt>Ends</dt><dd>{market.endDate ? formatDateTime(market.endDate) : "Not set"}</dd></div>
      <div className="pdSource"><dt>Result from</dt><dd>{source ? <a href={source.href} target="_blank" rel="noreferrer">{source.host}</a> : market.resolutionSource ?? "Polymarket's rules"}</dd></div>
    </dl>
  </section>;
}

