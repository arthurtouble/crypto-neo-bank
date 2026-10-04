"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useApi } from "@/lib/client/api";
import { useOverview } from "@/lib/client/queries";
import type { AssetId, CatalogAsset } from "@/lib/swap/assets";
import { groupAssets, heldFirst, optionLabel } from "@/lib/swap/picker-model";

type Props = { value: AssetId; label: string; held?: boolean; disabled?: boolean; onSelect(id: AssetId): void };

/**
 * Choose an asset from Aura's reviewed list, as a dropdown grouped like the Overview. The side that pays (`held`) lists
 * what the account can hold, with its balance, what it holds first in each group; the side that receives lists every
 * swappable asset.
 */
export function SwapAssetSelect({ value, label, held = false, disabled, onSelect }: Props) {
  const api = useApi();
  const catalog = useQuery({ queryKey: ["swap-assets", held], staleTime: 30_000,
    queryFn: () => api<{ assets: CatalogAsset[] }>(`/api/swap/assets${held ? "?held=1" : ""}`) });
  const overview = useOverview();
  const balances = useMemo(() => new Map((overview.data?.holdings ?? []).map((item) => [item.id, item.amountRaw])), [overview.data]);
  const assets = useMemo(() => {
    const list = catalog.data?.assets ?? [];
    return held ? heldFirst(list, balances) : list;
  }, [catalog.data, held, balances]);
  const balance = (asset: CatalogAsset) => !held || overview.isPending ? undefined : balances.has(asset.id) ? balances.get(asset.id) ?? null : "0";

  return <select className="mxSwapSelect" aria-label={label} value={value} disabled={disabled || catalog.isPending || catalog.isError}
    onChange={(event) => onSelect(event.target.value)}>
    {/* The chosen asset stays listed while the list loads or if it's missing from it, so the select never shows blank. */}
    {!assets.some((asset) => asset.id === value) && <option value={value}>{catalog.isError ? "Assets are unavailable" : "Loading assets"}</option>}
    {groupAssets(assets).map((group) => <optgroup key={group.label} label={group.label}>
      {group.assets.map((asset) => <option key={asset.id} value={asset.id} disabled={asset.eligibility !== "eligible"}>{optionLabel(asset, balance(asset))}</option>)}
    </optgroup>)}
  </select>;
}
