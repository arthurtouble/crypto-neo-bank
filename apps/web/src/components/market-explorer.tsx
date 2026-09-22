"use client";

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { LoaderCircle, Search, Star, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { marketSwapAssetId } from "@/lib/markets/swap-links";
import type { CatalogAsset } from "@/lib/swap/assets";

type Market = { id: string; symbol: string; name: string; image: string | null; current_price: number | null; market_cap: number | null; market_cap_rank: number | null; total_volume: number | null; price_change_percentage_24h: number | null; price_change_percentage_7d: number | null; day_high: number; day_low: number; last_updated: string };
type Response = { markets: Market[]; page: number; total: number; observedAt: string; authority: string };

function money(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", notation: value >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: value < 1 ? 5 : 2 }).format(value);
}

export function MarketExplorer() {
  const { getAccessToken } = usePrivy();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [saved, setSaved] = useState<string[]>([]);
  const [selected, setSelected] = useState<Market | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try { setSaved(JSON.parse(localStorage.getItem("aurel-market-watchlist") ?? "[]") as string[]); } catch { setSaved([]); }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);
  const result = useQuery<Response>({ queryKey: ["market-list", page, search], queryFn: async () => { const response = await fetch(`/api/market-data?page=${page}&search=${encodeURIComponent(search)}`); if (!response.ok) throw new Error("Markets are unavailable."); return response.json(); }, staleTime: 60_000 });
  const searching = query.trim() !== search;
  const rows = result.data?.markets ?? [];
  const selectedSwapAssetId = selected ? marketSwapAssetId(selected) : null;
  const selectedSwapAsset = useQuery<CatalogAsset | null>({
    queryKey: ["market-swap-asset", selectedSwapAssetId], enabled: Boolean(selectedSwapAssetId), retry: false, staleTime: 30_000,
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to check asset availability.");
      const response = await fetch(`/api/swap/assets?import=${encodeURIComponent(selectedSwapAssetId!)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Asset availability is unknown.");
      return (await response.json() as { asset: CatalogAsset }).asset;
    }
  });
  const canOpenSwap = Boolean(selectedSwapAssetId && selectedSwapAsset.data?.id === selectedSwapAssetId && selectedSwapAsset.data.eligibility === "eligible");
  function toggle(id: string) { const next = saved.includes(id) ? saved.filter((item) => item !== id) : [...saved, id]; setSaved(next); localStorage.setItem("aurel-market-watchlist", JSON.stringify(next)); }

  return <section className="panel marketExplorer">
    <div className="marketExplorerHeader"><div><h2>Markets</h2><p>Follow prices and choose what to explore.</p></div><label className="marketSearch"><Search size={16} /><span className="srOnly">Search markets</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} maxLength={80} placeholder="Search all markets" /></label></div>
    <div className="marketTable">
      <div className="marketTableHead"><span>Asset</span><span>Price</span><span>24H</span><span>Day Range</span><span>24H Volume</span><span /></div>
      {searching || result.isPending ? <div className="chartState"><LoaderCircle className="spin" size={18} /> {searching ? "Searching markets" : "Loading markets"}</div> : result.error ? <div className="chartState">Live markets are temporarily unavailable.</div> : rows.length === 0 ? <div className="chartState">No markets found.</div> : rows.map((market) => { const change = market.price_change_percentage_24h ?? 0; return <div className="marketTableRow" key={market.id}>
        <button className={`watchButton ${saved.includes(market.id) ? "saved" : ""}`} type="button" onClick={() => toggle(market.id)} aria-label={`${saved.includes(market.id) ? "Remove" : "Add"} ${market.name} ${saved.includes(market.id) ? "from" : "to"} watchlist`}><Star size={15} fill={saved.includes(market.id) ? "currentColor" : "none"} /></button>
        <span className="marketIdentity"><span className="marketGlyph">{market.symbol.slice(0, 1).toUpperCase()}</span><span><strong>{market.name}</strong><small>{market.symbol.toUpperCase()}</small></span></span>
        <strong>{money(market.current_price)}</strong>
        <span className={change >= 0 ? "positive" : "negative"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>
        <span className="dayRange">{money(market.day_low)} – {money(market.day_high)}</span>
        <span>{money(market.total_volume)}</span>
        <button className="button quiet small" type="button" onClick={() => setSelected(market)}>Details</button>
      </div>})}
    </div>
    <div className="marketPagination"><button className="button secondary small" disabled={page === 1 || searching || result.isPending} onClick={() => setPage((value) => value - 1)}>Previous</button><span>{searching ? "Searching" : result.data?.total ? `${((page - 1) * 50) + 1}–${Math.min(page * 50, result.data.total)} of ${result.data.total}` : "0 markets"}</span><button className="button secondary small" disabled={searching || result.isPending || !result.data || page * 50 >= result.data.total} onClick={() => setPage((value) => value + 1)}>Next</button></div>
    {selected && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><section className="financialModal marketDetailModal" role="dialog" aria-modal="true" aria-labelledby="market-detail-title"><button className="modalClose" onClick={() => setSelected(null)} aria-label="Close"><X size={18} /></button><div className="marketDetailIdentity"><span className="marketGlyph large">{selected.symbol.slice(0, 1).toUpperCase()}</span><div><small>{selected.symbol.toUpperCase()} / USD</small><h2 id="market-detail-title">{selected.name}</h2></div></div><strong className="marketDetailPrice">{money(selected.current_price)}</strong><span className={(selected.price_change_percentage_24h ?? 0) >= 0 ? "positive" : "negative"}>{(selected.price_change_percentage_24h ?? 0) >= 0 ? "+" : ""}{(selected.price_change_percentage_24h ?? 0).toFixed(2)}% today</span><div className="transactionSummary"><span>Day Low<strong>{money(selected.day_low)}</strong></span><span>Day High<strong>{money(selected.day_high)}</strong></span><span>24H Volume<strong>{money(selected.total_volume)}</strong></span></div><button className="button secondary full" onClick={() => toggle(selected.id)}><Star size={15} fill={saved.includes(selected.id) ? "currentColor" : "none"} />{saved.includes(selected.id) ? "Remove from Watchlist" : "Add to Watchlist"}</button>{canOpenSwap ? <Link className="button primary full" href={`/app/exchange?to=${encodeURIComponent(selectedSwapAssetId!)}`}>Swap</Link> : <span className="statusBadge neutral marketViewOnly">View Only</span>}<p className="authorityFootnote">Market prices are reference data. A live Swap route may differ.</p></section></div>}
  </section>;
}
