"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { usePrivy } from "@privy-io/react-auth";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AssetId, CatalogAsset } from "@/lib/swap/assets";
import { parseAssetId } from "@/lib/swap/assets";
import { assetCaption, assetNetwork, contractHint } from "@/lib/swap/picker-model";

type CatalogPage = { assets: CatalogAsset[]; nextCursor: string | null };
/** `held` lists only assets the account can hold, for the side that pays. */
type Props = { value: AssetId | null; onSelect(id: AssetId): void; excludedId?: AssetId | null; label: string; held?: boolean };

/** Choose an asset from Aura's reviewed list. Nothing outside it can be found, even by contract address. */
export function SwapAssetPicker({ value, onSelect, excludedId, label, held = false }: Props) {
  const { getAccessToken } = usePrivy();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
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
    queryKey: ["swap-asset-search", debounced, held], enabled: open, initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const exactImport = parseAssetId(debounced) && !pageParam;
      const params = new URLSearchParams(exactImport ? { import: debounced } : { q: debounced, ...(held ? { held: "1" } : {}) });
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
    onSelect(asset.id);
    setOpen(false);
  }

  return <Dialog.Root open={open} onOpenChange={(next) => { setOpen(next); setActive(0); }}>
    <Dialog.Trigger asChild><button className="mxPickerTrigger" type="button" aria-label={`${label}: ${selected.data ? assetCaption(selected.data) : "Choose asset"}`}>
      {selected.data ? <><span className="mxPickerSymbol">{selected.data.symbol}</span><span className="mxPickerNetwork">{assetNetwork(selected.data.chainId)}</span></> : <span>Choose asset</span>}
    </button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="mxPickerOverlay" /><Dialog.Content className="mxPicker" aria-describedby={undefined}>
      <div className="mxPickerHead"><Dialog.Title>Choose an asset</Dialog.Title><Dialog.Close className="appIconButton mxPickerClose" aria-label="Close"><X aria-hidden="true" /></Dialog.Close></div>
      <>
        <label className="mxPickerSearch"><Search aria-hidden="true" /><span className="srOnly">Search assets or contract address</span><input autoFocus value={search} onChange={(event) => { setSearch(event.target.value); setActive(0); }} placeholder="Search name or contract" onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, assets.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          if (event.key === "Enter" && assets[active]) { event.preventDefault(); choose(assets[active]); }
        }} /></label>
        <div className="mxPickerResults" aria-live="polite">
          {!debounced && !pages.isPending && !pages.isError && <div className="mxPickerState">{held ? "In your account" : "Supported assets"}</div>}
          {pages.isPending ? <div className="mxPickerState"><LoaderCircle className="spin" aria-hidden="true" /> Loading assets</div>
            : pages.isError ? <div className="mxPickerState">Assets are unavailable. <button type="button" onClick={() => void pages.refetch()}>Try again</button></div>
              : assets.length === 0 ? <div className="mxPickerState">No matching assets</div>
                : assets.map((asset, index) => <button type="button" key={asset.id} className={`swapPickerOption mxPickerOption${index === active ? " isActive" : ""}`} disabled={asset.id === excludedId || asset.eligibility !== "eligible"} onMouseEnter={() => setActive(index)} onClick={() => choose(asset)}>
                  <span className="mxPickerGlyph" aria-hidden="true">{asset.symbol.slice(0, 1).toUpperCase()}</span><span className="mxPickerIdentity"><strong>{asset.symbol}<small>{asset.name}</small></strong><span>{assetNetwork(asset.chainId)} · {contractHint(asset)}</span></span>
                  {asset.eligibility === "eligible" ? <span className="mxPickerTrust"><Check aria-hidden="true" /> Reviewed</span> : <span className="mxPickerTrust">Paused</span>}
                </button>)}
          {pages.hasNextPage && <button type="button" className="appButton mxPickerMore" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>{pages.isFetchingNextPage ? "Loading" : "Load more"}</button>}
        </div>
      </>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
