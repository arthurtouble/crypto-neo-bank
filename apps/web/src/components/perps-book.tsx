"use client";

import { bookRows, formatBookPrice, formatPrice, formatSize, formatSpreadPercent, type BookRow } from "@/lib/markets/view";
import { formatUsd } from "@/lib/format";
import { usePerpBook } from "./markets-data";
import { SourceLine } from "./markets-parts";
import { LoadingState, Notice } from "./states";

/**
 * A perp's order book from Hyperliquid, refreshed every 2.5 seconds: asks
 * above (the best, lowest, next to the spread), bids below, each row with its
 * price, size, running total in dollars, and a bar for that depth.
 */
export function PerpsBook({ coin, name, depth = 10, framed = true }: { coin: string; name: string; depth?: number; framed?: boolean }) {
  const query = usePerpBook(coin);
  const data = query.data;
  const rows = data?.status === "observed" ? bookRows(data.bids, data.asks, depth) : null;
  const content = query.isPending ? <LoadingState label="Reading the order book" />
    : !data || data.status !== "observed" || !rows ? <Notice tone="warning" role="alert" onRetry={() => void query.refetch()} data-testid="perps-book-unavailable">
      <span className="appUnavailable">Unavailable.</span> We couldn&apos;t read the order book from Hyperliquid.</Notice>
      : <div className="mkBook" role="table" aria-label={`${name} order book`} data-testid="perps-book">
        <div role="rowgroup"><div className="mkBookRow mkBookHead" role="row">
          <span role="columnheader">Price (USD)</span><span role="columnheader">Amount ({name})</span><span role="columnheader">Total (USD)</span></div></div>
        <div role="rowgroup" aria-label="Asks">{[...rows.asks].reverse().map((row) => <Level key={`a${row.price}`} row={row} side="ask" />)}</div>
        <div role="rowgroup"><div className="mkBookRow mkSpread" role="row" data-testid="perps-spread">
          <span role="cell">Spread</span><span role="cell">{data.spread === null ? "—" : formatPrice(data.spread)}</span>
          <span role="cell">{formatSpreadPercent(data.spreadPercent) ?? "—"}</span></div></div>
        <div role="rowgroup" aria-label="Bids">{rows.bids.map((row) => <Level key={`b${row.price}`} row={row} side="bid" />)}</div>
      </div>;
  const source = data && <SourceLine source="hyperliquid" observedAt={data.observedAt} example={query.isExample} />;
  if (!framed) return <div className="mkBookWrap">{content}{source}</div>;
  return <section className="mxCard mkBookCard" aria-labelledby="perps-book-title">
    <h2 id="perps-book-title">Order book</h2>
    {content}
    {source}
  </section>;
}

function Level({ row, side }: { row: BookRow; side: "ask" | "bid" }) {
  return <div className={`mkBookRow is-${side}`} role="row">
    <span className="mkDepth" aria-hidden="true" style={{ inlineSize: `${Math.round(row.depth * 100)}%` }} />
    <span role="cell" className="mkBookPrice">{formatBookPrice(row.price)}</span>
    <span role="cell">{formatSize(row.size)}</span>
    <span role="cell">{formatUsd(row.total, { whole: true })}</span>
  </div>;
}
