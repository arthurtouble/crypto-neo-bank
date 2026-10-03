"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { bookGroupings, bookRows, formatBookPrice, formatPrice, formatSize, formatSpreadPercent, type BookGroupingOption, type BookRow } from "@/lib/markets/view";
import { formatUsd } from "@/lib/format";
import { usePerpBook, type PerpMarket } from "./markets-data";
import { SourceLine } from "./markets-parts";
import { LoadingState, Notice } from "./states";

/**
 * A perp's order book from Hyperliquid, refreshed every 2.5 seconds: asks
 * above (the best, lowest, next to the spread), bids below, each row with its
 * price, size, running total in dollars, and a bar for that depth. A dropdown
 * groups prices by a dollar step that suits the price, as Hyperliquid offers.
 * Picking a row starts a limit order at its price: an ask to buy (long) at it,
 * a bid to sell (short) at it, the side that would trade with that row.
 */
export function PerpsBook({ market, name, depth = 10, framed = true, onPick, grouping: held }: { market: PerpMarket; name: string; depth?: number; framed?: boolean;
  onPick?: (pick: { price: string; side: "long" | "short" }) => void;
  /** The chosen step, held by the page so it stays when the phone's tab switches away and back. */
  grouping?: { step: number | null; onStep: (step: number) => void } }) {
  const coin = market.coin;
  // The steps follow the price's size, which changes rarely; read it once per market and whole digit count.
  const digits = Math.floor(Math.log10(Number(market.markPx) || 1));
  const options = useMemo(() => bookGroupings(market.markPx, market.szDecimals), [digits, market.szDecimals]); // eslint-disable-line react-hooks/exhaustive-deps
  const [own, setOwn] = useState<number | null>(null);
  const step = held ? held.step : own;
  const setStep = held ? held.onStep : setOwn;
  const grouping = options.find((option) => option.step === step) ?? options[0] ?? null;
  const query = usePerpBook(coin, true, grouping);
  const data = query.data;
  const rows = data?.status === "observed" ? bookRows(data.bids, data.asks, depth) : null;
  const pick = onPick ? (row: BookRow, side: "ask" | "bid") => onPick({ price: row.price, side: side === "ask" ? "long" : "short" }) : undefined;
  const tools = options.length > 1 && grouping && <GroupingMenu options={options} value={grouping} onChange={(option) => setStep(option.step)} />;
  const content = query.isPending ? <LoadingState label="Reading the order book" />
    : !data || data.status !== "observed" || !rows ? <Notice tone="warning" role="alert" onRetry={() => void query.refetch()} data-testid="perps-book-unavailable">
      <span className="appUnavailable">Unavailable.</span> We couldn&apos;t read the order book from Hyperliquid.</Notice>
      : <div className="mkBook" role="table" aria-label={`${name} order book`} data-testid="perps-book">
        <div role="rowgroup"><div className="mkBookRow mkBookHead" role="row">
          <span role="columnheader">Price (USD)</span><span role="columnheader">Amount ({name})</span><span role="columnheader">Total (USD)</span></div></div>
        <div role="rowgroup" aria-label="Asks">{[...rows.asks].reverse().map((row, index) => <Level key={`a${index}`} row={row} side="ask" onPick={pick} />)}</div>
        <div role="rowgroup"><div className="mkBookRow mkSpread" role="row" data-testid="perps-spread">
          <span role="cell">Spread</span><span role="cell">{data.spread === null ? "—" : formatPrice(data.spread)}</span>
          <span role="cell">{formatSpreadPercent(data.spreadPercent) ?? "—"}</span></div></div>
        <div role="rowgroup" aria-label="Bids">{rows.bids.map((row, index) => <Level key={`b${index}`} row={row} side="bid" onPick={pick} />)}</div>
      </div>;
  const foot = data && <p className="mkBookFoot">{onPick && rows ? "Pick a price to place a limit order there. " : ""}
    <SourceLine source="hyperliquid" observedAt={data.observedAt} example={query.isExample} /></p>;
  if (!framed) return <div className="mkBookWrap">{tools && <div className="mkBookTools"><span className="mkLabel">Group by</span>{tools}</div>}{content}{foot}</div>;
  return <section className="mxCard mkBookCard" aria-labelledby="perps-book-title">
    <div className="mkBookTools"><h2 id="perps-book-title">Order book</h2>{tools}</div>
    {content}
    {foot}
  </section>;
}

/** The grouping dropdown: the step now, which opens the steps on offer. Escape or a tap outside closes it. */
function GroupingMenu({ options, value, onChange }: { options: BookGroupingOption[]; value: BookGroupingOption; onChange: (option: BookGroupingOption) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
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
  return <div className="mkGroupMenu" ref={root}>
    <button type="button" ref={button} className="mkGroupButton" aria-expanded={open} aria-controls={id} aria-label={`Group prices by $${value.label}`}
      onClick={() => setOpen((current) => !current)}><span aria-hidden="true">{value.label}</span><ChevronDown aria-hidden="true" /></button>
    {open && <div className="mkGroupOptions" id={id} role="radiogroup" aria-label="Group prices by">
      {options.map((option) => <button type="button" role="radio" key={option.step} aria-checked={option.step === value.step}
        onClick={() => { onChange(option); setOpen(false); button.current?.focus(); }}>${option.label}</button>)}
    </div>}
  </div>;
}

function Level({ row, side, onPick }: { row: BookRow; side: "ask" | "bid"; onPick?: (row: BookRow, side: "ask" | "bid") => void }) {
  const price = formatBookPrice(row.price);
  const choose = onPick ? () => onPick(row, side) : undefined;
  return <div className={`mkBookRow is-${side}${choose ? " is-pickable" : ""}`} role="row" tabIndex={choose ? 0 : undefined}
    title={choose ? `${side === "ask" ? "Long" : "Short"} at ${price}` : undefined} onClick={choose}
    onKeyDown={choose ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } } : undefined}>
    <span className="mkDepth" aria-hidden="true" style={{ inlineSize: `${Math.round(row.depth * 100)}%` }} />
    <span role="cell" className="mkBookPrice">{price}</span>
    <span role="cell">{formatSize(row.size)}</span>
    <span role="cell">{formatUsd(row.total, { whole: true })}</span>
  </div>;
}
