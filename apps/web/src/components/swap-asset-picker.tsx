"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { usePrivy } from "@privy-io/react-auth";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AssetId, CatalogAsset } from "@/lib/swap/assets";
import { parseAssetId } from "@/lib/swap/assets";
import { assetCaption, assetNetwork, contractHint, needsRiskConfirmation } from "@/lib/swap/picker-model";

type CatalogPage = { assets: CatalogAsset[]; nextCursor: string | null };
type Props = { value: AssetId | null; onSelect(id: AssetId): void; excludedId?: AssetId | null; label: string };

export function SwapAssetPicker({ value, onSelect, excludedId, label }: Props) {
  const { getAccessToken } = usePrivy();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [riskAsset, setRiskAsset] = useState<CatalogAsset | null>(null);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  async function fetchCatalog(url: string): Promise<Response> {
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in to search assets.");
    return fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  }

  const selected = useQuery<CatalogAsset | null>({
    queryKey: ["swap-selected-asset", value], enabled: Boolean(value), staleTime: 30_000,
    queryFn: async () => {
      const response = await fetchCatalog(`/api/swap/assets?import=${encodeURIComponent(value!)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Selected asset is unavailable.");
      const body = await response.json() as { asset: CatalogAsset };
      return body.asset;
    }
  });
  const pages = useInfiniteQuery<CatalogPage>({
    queryKey: ["swap-asset-search", debounced], enabled: open, initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const exactImport = parseAssetId(debounced) && !pageParam;
      const params = new URLSearchParams(exactImport ? { import: debounced } : { q: debounced });
      if (pageParam) params.set("cursor", String(pageParam));
      const response = await fetchCatalog(`/api/swap/assets?${params}`);
      if (response.status === 404) return { assets: [], nextCursor: null };
      if (!response.ok) throw new Error("Assets are unavailable. Try again.");
      const body = await response.json() as CatalogPage & { asset?: CatalogAsset };
      return body.asset ? { assets: [body.asset], nextCursor: null } : body;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000
  });
  const assets = useMemo(() => pages.data?.pages.flatMap((page) => page.assets) ?? [], [pages.data]);

  function choose(asset: CatalogAsset) {
    if (asset.id === excludedId || asset.eligibility !== "eligible") return;
    if (needsRiskConfirmation(asset)) { setRiskAsset(asset); return; }
    onSelect(asset.id);
    setOpen(false);
  }

  return <Dialog.Root open={open} onOpenChange={(next) => { setOpen(next); setActive(0); setRiskAsset(null); }}>
    <Dialog.Trigger asChild><button className="swapPickerTrigger" type="button" aria-label={`${label}: ${selected.data ? assetCaption(selected.data) : "Choose asset"}`}>
      {selected.data ? <><span className="swapPickerSymbol">{selected.data.symbol}</span><span className="swapPickerNetwork">{assetNetwork(selected.data.chainId)}</span></> : <span>Choose asset</span>}
    </button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="swapPickerOverlay" /><Dialog.Content className="swapPickerDialog" aria-describedby={undefined}>
      <div className="swapPickerHeading"><Dialog.Title>{riskAsset ? "Check This Asset" : "Choose Asset"}</Dialog.Title><Dialog.Close className="swapPickerClose" aria-label="Close"><X size={18} /></Dialog.Close></div>
      {riskAsset ? <div className="swapPickerRisk">
        <strong>{riskAsset.name} · {assetNetwork(riskAsset.chainId)}</strong>
        <code>{riskAsset.address ?? "Native asset"}</code>
        <p>This contract is not verified by Aurel. Check the address before you continue.</p>
        <div className="swapPickerActions"><button type="button" className="button secondary" onClick={() => setRiskAsset(null)}>Back</button><button type="button" className="button primary" onClick={() => { onSelect(riskAsset.id); setOpen(false); setRiskAsset(null); }}>Select Asset</button></div>
      </div> : <>
        <label className="swapPickerSearch"><Search size={18} /><span className="srOnly">Search assets or contract address</span><input autoFocus value={search} onChange={(event) => { setSearch(event.target.value); setActive(0); setRiskAsset(null); }} placeholder="Search name or contract" onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, assets.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          if (event.key === "Enter" && assets[active]) { event.preventDefault(); choose(assets[active]); }
        }} /></label>
        <div className="swapPickerResults" aria-live="polite">
          {pages.isPending ? <div className="swapPickerState"><LoaderCircle className="spin" size={17} /> Loading assets</div>
            : pages.isError ? <div className="swapPickerState">Assets are unavailable. <button type="button" onClick={() => void pages.refetch()}>Try Again</button></div>
              : assets.length === 0 ? <div className="swapPickerState">No matching assets</div>
                : assets.map((asset, index) => <button type="button" key={asset.id} className={`swapPickerOption ${index === active ? "active" : ""}`} disabled={asset.id === excludedId || asset.eligibility !== "eligible"} onMouseEnter={() => setActive(index)} onClick={() => choose(asset)}>
                  <span className="swapPickerGlyph">{asset.symbol.slice(0, 1).toUpperCase()}</span><span className="swapPickerIdentity"><strong>{asset.symbol}<small>{asset.name}</small></strong><span>{assetNetwork(asset.chainId)} · {contractHint(asset)}</span></span>
                  <span className="swapPickerTrust">{asset.verification === "verified" ? <><Check size={14} /> Verified</> : "Unverified"}</span>
                </button>)}
          {pages.hasNextPage && <button type="button" className="swapPickerMore" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>{pages.isFetchingNextPage ? "Loading" : "Load More"}</button>}
        </div>
      </>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
