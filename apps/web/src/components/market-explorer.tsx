"use client";

import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Search, Star, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { marketSwapAssetId } from "@/config/swap-assets";

type Market = { id: string; symbol: string; name: string; image: string | null; current_price: number | null; market_cap: number | null; market_cap_rank: number | null; total_volume: number | null; price_change_percentage_24h: number | null; price_change_percentage_7d: number | null; day_high: number; day_low: number; last_updated: string };
type Response = { markets: Market[]; page: number; observedAt: string; authority: string };

function money(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", notation: value >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: value < 1 ? 5 : 2 }).format(value);
}

export function MarketExplorer() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [saved, setSaved] = useState<string[]>([]);
  const [selected, setSelected] = useState<Market | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try { setSaved(JSON.parse(localStorage.getItem("aurel-market-watchlist") ?? "[]") as string[]); } catch { setSaved([]); }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const result = useQuery<Response>({ queryKey: ["market-list", page], queryFn: async () => { const response = await fetch(`/api/market-data?page=${page}`); if (!response.ok) throw new Error("Markets are unavailable."); return response.json(); }, staleTime: 60_000 });
  const rows = useMemo(() => result.data?.markets.filter((market) => `${market.name} ${market.symbol}`.toLowerCase().includes(query.toLowerCase().trim())) ?? [], [query, result.data]);
  const selectedSwapAssetId = selected ? marketSwapAssetId(selected) : null;
  function toggle(id: string) { const next = saved.includes(id) ? saved.filter((item) => item !== id) : [...saved, id]; setSaved(next); localStorage.setItem("aurel-market-watchlist", JSON.stringify(next)); }

  return <section className="panel marketExplorer">
    <div className="marketExplorerHeader"><div><h2>Markets</h2><p>Follow prices and choose what to explore.</p></div><label className="marketSearch"><Search size={16} /><span className="srOnly">Search markets</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" /></label></div>
    <div className="marketTable">
      <div className="marketTableHead"><span>Asset</span><span>Price</span><span>24H</span><span>Day Range</span><span>24H Volume</span><span /></div>
      {result.isPending ? <div className="chartState"><LoaderCircle className="spin" size={18} /> Loading markets</div> : result.error ? <div className="chartState">Live markets are temporarily unavailable.</div> : rows.map((market) => { const change = market.price_change_percentage_24h ?? 0; return <div className="marketTableRow" key={market.id}>
        <button className={`watchButton ${saved.includes(market.id) ? "saved" : ""}`} type="button" onClick={() => toggle(market.id)} aria-label={`${saved.includes(market.id) ? "Remove" : "Add"} ${market.name} ${saved.includes(market.id) ? "from" : "to"} watchlist`}><Star size={15} fill={saved.includes(market.id) ? "currentColor" : "none"} /></button>
        <span className="marketIdentity"><span className="marketGlyph">{market.symbol.slice(0, 1).toUpperCase()}</span><span><strong>{market.name}</strong><small>{market.symbol.toUpperCase()}</small></span></span>
        <strong>{money(market.current_price)}</strong>
        <span className={change >= 0 ? "positive" : "negative"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>
        <span className="dayRange">{money(market.day_low)} – {money(market.day_high)}</span>
        <span>{money(market.total_volume)}</span>
        <button className="button quiet small" type="button" onClick={() => setSelected(market)}>Details</button>
      </div>})}
    </div>
    <div className="marketPagination"><button className="button secondary small" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Top {((page - 1) * 50) + 1}–{page * 50}</span><button className="button secondary small" disabled={page === 5} onClick={() => setPage((value) => value + 1)}>Next</button></div>
    {selected && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><section className="financialModal marketDetailModal" role="dialog" aria-modal="true" aria-labelledby="market-detail-title"><button className="modalClose" onClick={() => setSelected(null)} aria-label="Close"><X size={18} /></button><div className="marketDetailIdentity"><span className="marketGlyph large">{selected.symbol.slice(0, 1).toUpperCase()}</span><div><small>{selected.symbol.toUpperCase()} / USD</small><h2 id="market-detail-title">{selected.name}</h2></div></div><strong className="marketDetailPrice">{money(selected.current_price)}</strong><span className={(selected.price_change_percentage_24h ?? 0) >= 0 ? "positive" : "negative"}>{(selected.price_change_percentage_24h ?? 0) >= 0 ? "+" : ""}{(selected.price_change_percentage_24h ?? 0).toFixed(2)}% today</span><div className="transactionSummary"><span>Day Low<strong>{money(selected.day_low)}</strong></span><span>Day High<strong>{money(selected.day_high)}</strong></span><span>24H Volume<strong>{money(selected.total_volume)}</strong></span></div><button className="button secondary full" onClick={() => toggle(selected.id)}><Star size={15} fill={saved.includes(selected.id) ? "currentColor" : "none"} />{saved.includes(selected.id) ? "Remove from Watchlist" : "Add to Watchlist"}</button>{selectedSwapAssetId ? <Link className="button primary full" href={`/app/exchange?to=${selectedSwapAssetId}`}>Swap</Link> : <span className="statusBadge neutral marketViewOnly">View Only</span>}<p className="authorityFootnote">{selectedSwapAssetId ? "Aurel will compare live routes before you approve anything." : "Market data does not mean this asset is available to buy or sell in Aurel."}</p></section></div>}
  </section>;
}
