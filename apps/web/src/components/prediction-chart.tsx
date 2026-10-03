"use client";

import { useState } from "react";
import { formatShortDateTime } from "@/lib/format";
import { formatChance } from "@/lib/markets/view";
import { formatAssetPrice, type Tick } from "@/lib/markets/predictions-view";

const WIDTH = 600;

/** The point nearest the pointer, by time. */
function nearest(points: Array<{ time: number }>, time: number): number {
  let best = 0;
  points.forEach((point, index) => { if (Math.abs(point.time - time) < Math.abs(points[best].time - time)) best = index; });
  return best;
}

/**
 * The first outcome's chance over time: one line in the accent, the chance
 * levels at the right edge, a hover readout, and the range in words for
 * screen readers. `points` are seconds and prices (0–1), oldest first.
 */
export function OddsChart({ points, label }: { points: Array<{ time: number; price: number }>; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="mxHint mkEmptyLine">Not enough trading yet to draw the odds.</p>;
  const height = 200, pad = 8;
  const t0 = points[0].time, t1 = points[points.length - 1].time;
  const x = (time: number) => pad + ((time - t0) / Math.max(1, t1 - t0)) * (WIDTH - 2 * pad);
  const y = (price: number) => pad + (1 - price) * (height - 2 * pad);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.time).toFixed(1)},${y(point.price).toFixed(1)}`).join(" ");
  const low = Math.min(...points.map((point) => point.price)), high = Math.max(...points.map((point) => point.price));
  const shown = hover === null ? null : points[hover];
  const last = points[points.length - 1];
  return <figure className="pdChart">
    <div className="pdChartPlot">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" role="img"
        aria-label={`${label} chance from ${formatChance(points[0].price)} to ${formatChance(last.price)}, between ${formatChance(low)} and ${formatChance(high)}`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setHover(nearest(points, t0 + ((event.clientX - box.left) / box.width) * (t1 - t0)));
        }} onPointerLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map((level) => <line key={level} className="pdChartGrid" x1={pad} x2={WIDTH - pad} y1={y(level)} y2={y(level)} vectorEffect="non-scaling-stroke" />)}
        <path className="pdChartLine" d={path} vectorEffect="non-scaling-stroke" />
        {shown && <line className="pdChartCursor" x1={x(shown.time)} x2={x(shown.time)} y1={pad} y2={height - pad} vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="pdChartTicks" aria-hidden="true">{[0.75, 0.5, 0.25].map((level) =>
        <span key={level} style={{ top: `${(y(level) / height) * 100}%` }}>{Math.round(level * 100)}%</span>)}</span>
      <span className="pdChartDot" aria-hidden="true" style={{ left: `${(x(last.time) / WIDTH) * 100}%`, top: `${(y(last.price) / height) * 100}%` }} />
    </div>
    <figcaption className="pdChartCaption">{shown ? <><strong>{formatChance(shown.price)}</strong> {formatShortDateTime(shown.time * 1000)}</>
      : <>{formatShortDateTime(t0 * 1000)} to {formatShortDateTime(t1 * 1000)}</>}</figcaption>
  </figure>;
}

const clock = (time: number) => new Date(time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

/**
 * An Up or Down market's live price: every tick from the stream as one line
 * in the accent, the price to beat as a dashed line across, the last price
 * as a dot with its value at the right edge, and a hover readout. The plot
 * keeps the price to beat in view, so how far above or below it the price
 * is reads at a glance.
 */
export function LivePriceChart({ ticks, priceToBeat, asset }: { ticks: Tick[]; priceToBeat: number | null; asset: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const height = 240, padTop = 16, padBottom = 16;
  const right = WIDTH * 0.86;
  const t0 = ticks[0].time, t1 = Math.max(ticks[ticks.length - 1].time, t0 + 30_000);
  const prices = ticks.map((tick) => tick.price);
  const last = ticks[ticks.length - 1];
  const lowest = Math.min(...prices, priceToBeat ?? Infinity), highest = Math.max(...prices, priceToBeat ?? -Infinity);
  // At least a few hundredths of a percent of range, so a quiet minute doesn't look like a crash.
  const span = Math.max(highest - lowest, last.price * 0.0003);
  const low = lowest - span * 0.15, high = lowest + span * 1.15;
  const x = (time: number) => ((time - t0) / Math.max(1, t1 - t0)) * right;
  const y = (price: number) => padTop + (1 - (price - low) / (high - low)) * (height - padTop - padBottom);
  const path = ticks.map((tick, index) => `${index ? "L" : "M"}${x(tick.time).toFixed(1)},${y(tick.price).toFixed(1)}`).join(" ");
  const shown = hover === null ? null : ticks[hover];
  const above = priceToBeat === null ? null : last.price >= priceToBeat;
  const percent = (value: number, of: number) => `${(value / of) * 100}%`;
  return <figure className="pdChart pdLiveChart" data-testid="prediction-live-chart">
    <div className="pdChartPlot">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" role="img"
        aria-label={`${asset} price, live: ${formatAssetPrice(last.price)}${priceToBeat === null ? "" : `, ${above ? "at or above" : "below"} the price to beat of ${formatAssetPrice(priceToBeat)}`}`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const time = t0 + (((event.clientX - box.left) / box.width) * WIDTH / right) * (t1 - t0);
          setHover(nearest(ticks, time));
        }} onPointerLeave={() => setHover(null)}>
        {priceToBeat !== null && <line className="pdBeatLine" x1={0} x2={WIDTH} y1={y(priceToBeat)} y2={y(priceToBeat)} vectorEffect="non-scaling-stroke" />}
        <path className="pdChartLine" d={path} vectorEffect="non-scaling-stroke" />
        {shown && <line className="pdChartCursor" x1={x(shown.time)} x2={x(shown.time)} y1={padTop} y2={height - padBottom} vectorEffect="non-scaling-stroke" />}
      </svg>
      {priceToBeat !== null && <span className="pdBeatLabel" aria-hidden="true" style={{ top: percent(y(priceToBeat), height) }}>Price to beat</span>}
      <span className="pdChartDot" aria-hidden="true" style={{ left: percent(x(last.time), WIDTH), top: percent(y(last.price), height) }} />
      <span className={`pdLastLabel${above === null ? "" : above ? " is-above" : " is-below"}`} aria-hidden="true" style={{ top: percent(y(last.price), height) }}>
        {formatAssetPrice(last.price)}</span>
    </div>
    <figcaption className="pdChartCaption">{shown ? <><strong>{formatAssetPrice(shown.price)}</strong> {clock(shown.time)}</>
      : <>{clock(t0)} to {clock(ticks[ticks.length - 1].time)}</>}</figcaption>
  </figure>;
}
