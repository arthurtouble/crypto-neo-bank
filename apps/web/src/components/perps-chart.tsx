"use client";

import { CandlestickChart, ChartLine } from "lucide-react";
import { useState } from "react";
import { formatShortDateTime } from "@/lib/format";
import { formatPrice, PERP_RANGES, type PerpRange } from "@/lib/markets/view";
import { usePerpCandles, type Candle } from "./markets-data";
import { Segmented, SourceLine } from "./markets-parts";
import { LoadingState, Notice } from "./states";

type Style = "line" | "candles";

/**
 * A perp's price over a range (Live, 1H … All) as a line or as candles, read
 * from Hyperliquid. Live polls every few seconds. Hovering shows a candle's
 * open, high, low, and close; a failed read shows as unavailable.
 */
export function PerpsChart({ coin, name }: { coin: string; name: string }) {
  const [range, setRange] = useState<PerpRange>("1d");
  const [style, setStyle] = useState<Style>("line");
  const query = usePerpCandles(coin, range);
  const data = query.data;
  return <section className="mxCard mkPriceChart" aria-label={`${name} price chart`}>
    <div className="mkChartTools">
      <Segmented label="Chart range" value={range} onChange={setRange} className="mkRanges"
        options={PERP_RANGES.map((item) => ({ value: item.value, label: item.label }))} />
      <Segmented label="Chart style" value={style} onChange={setStyle} className="mkStyles" options={[
        { value: "line", label: <><ChartLine aria-hidden="true" /><span className="srOnly">Line</span></> },
        { value: "candles", label: <><CandlestickChart aria-hidden="true" /><span className="srOnly">Candles</span></> }]} />
    </div>
    {query.isPending ? <LoadingState label={`Reading ${name}'s price history`} />
      : !data || data.status !== "observed" ? <Notice tone="warning" role="alert" onRetry={() => void query.refetch()} data-testid="perps-chart-unavailable">
        <span className="appUnavailable">Unavailable.</span> {name}&apos;s price history can&apos;t be loaded from Hyperliquid right now. Try again.</Notice>
        : <PriceChart candles={data.candles} style={style} name={name} />}
    {data && <SourceLine source="hyperliquid" observedAt={data.observedAt} example={query.isExample} />}
  </section>;
}

// The right edge is kept clear for the price labels.
const WIDTH = 600, HEIGHT = 240, PAD = 10, LABELS = 110;

function PriceChart({ candles, style, name }: { candles: Candle[]; style: Style; name: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = candles.map((candle) => ({ t: candle.t, o: Number(candle.o), h: Number(candle.h), l: Number(candle.l), c: Number(candle.c) }))
    .filter((point) => [point.o, point.h, point.l, point.c].every(Number.isFinite));
  if (points.length < 2) return <p className="mxHint mkEmptyLine">Not enough trading yet to draw a chart.</p>;

  const values = style === "candles" ? points.flatMap((point) => [point.h, point.l]) : points.map((point) => point.c);
  const low = Math.min(...values), high = Math.max(...values);
  const margin = (high - low) * 0.08 || high * 0.001 || 1;
  const bottom = low - margin, top = high + margin;
  const step = (WIDTH - PAD - LABELS) / points.length;
  const x = (index: number) => PAD + step * (index + 0.5);
  const y = (price: number) => PAD + (1 - (price - bottom) / (top - bottom)) * (HEIGHT - 2 * PAD);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.c).toFixed(1)}`).join(" ");
  const ticks = [0.2, 0.5, 0.8].map((share) => bottom + (top - bottom) * share);
  const shown = hover === null ? null : points[hover];
  const first = points[0], last = points[points.length - 1];
  const body = Math.max(1, step * 0.6);

  return <figure className="mkChart mkPerpChart">
    <div className="mkChartPlot">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" data-testid="perps-chart"
        aria-label={`${name} from ${formatPrice(first.c)} to ${formatPrice(last.c)}, between ${formatPrice(low)} and ${formatPrice(high)}`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const index = Math.floor(((event.clientX - box.left) / box.width) * WIDTH / step - PAD / step);
          setHover(Math.min(points.length - 1, Math.max(0, index)));
        }} onPointerLeave={() => setHover(null)}>
        {ticks.map((tick) => <line key={tick} className="mkChartGrid" x1={0} x2={WIDTH} y1={y(tick)} y2={y(tick)} vectorEffect="non-scaling-stroke" />)}
        {style === "line" ? <path className="mkChartLine" d={line} vectorEffect="non-scaling-stroke" />
          : points.map((point, index) => {
            const up = point.c >= point.o;
            return <g key={point.t} className={up ? "mkCandleUp" : "mkCandleDown"}>
              <line x1={x(index)} x2={x(index)} y1={y(point.h)} y2={y(point.l)} vectorEffect="non-scaling-stroke" />
              <rect x={x(index) - body / 2} width={body} y={y(Math.max(point.o, point.c))} height={Math.max(1, Math.abs(y(point.o) - y(point.c)))} />
            </g>;
          })}
        {hover !== null && <line className="mkChartCursor" x1={x(hover)} x2={x(hover)} y1={0} y2={HEIGHT} vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="mkChartTicks" aria-hidden="true">{ticks.map((tick) =>
        <span key={tick} style={{ top: `${(y(tick) / HEIGHT) * 100}%` }}>{formatPrice(tick)}</span>)}</span>
    </div>
    <figcaption className="mkChartCaption">{shown
      ? <><strong>{formatPrice(shown.c)}</strong> {formatShortDateTime(shown.t)} · Open {formatPrice(shown.o)} · High {formatPrice(shown.h)} · Low {formatPrice(shown.l)}</>
      : <>{formatShortDateTime(first.t)} to {formatShortDateTime(last.t)}</>}</figcaption>
  </figure>;
}
