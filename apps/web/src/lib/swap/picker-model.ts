import { BASE_CHAIN_ID, networkName, registeredAsset, type RegisteredAsset } from "@/lib/assets/registry";
import { formatToken, fromRaw } from "@/lib/format";
import type { CatalogAsset } from "./assets";

export function assetNetwork(chainId: number): string { return networkName(chainId); }

/**
 * One line in Swap's asset dropdown, named the way the Overview names it: "Apple · AAPLc", the network when it isn't
 * the account's own, what the account holds on the side that pays, "paused" when it can't be chosen, and "not available
 * where you are" for a stock that can't be bought from the customer's place.
 */
export function optionLabel(asset: CatalogAsset, heldRaw?: string | null, notHere = false): string {
  const network = asset.chainId === BASE_CHAIN_ID ? "" : ` on ${assetNetwork(asset.chainId)}`;
  const held = heldRaw === undefined ? "" : heldRaw === null ? " · balance unavailable" : ` · ${formatToken(fromRaw(heldRaw, asset.decimals))} available`;
  return `${asset.name} · ${asset.symbol}${network}${held}${asset.eligibility === "eligible" ? "" : " · paused"}${notHere ? " · not available where you are" : ""}`;
}

/** The side that pays: what the account holds comes first, in registry order, then the rest. */
export function heldFirst(assets: readonly CatalogAsset[], held: ReadonlyMap<string, string | null>): CatalogAsset[] {
  const has = (asset: CatalogAsset) => { const raw = held.get(asset.id); return raw ? BigInt(raw) > 0n : false; };
  return [...assets.filter(has), ...assets.filter((asset) => !has(asset))];
}

/** A stock, which some places can't buy (the server says which, in the asset list's `places`). */
export function isStock(asset: Pick<CatalogAsset, "id">): boolean { return registeredAsset(asset.id)?.category === "stock"; }

const GROUPS: ReadonlyArray<[RegisteredAsset["category"], string]> = [["cash", "Cash"], ["crypto", "Crypto"], ["stock", "Stocks"], ["metal", "Metals"]];

/**
 * The dropdown in the Overview's groups (Cash, Crypto, Stocks, Metals), keeping the order within each, so a stock is
 * found under Stocks rather than by its ticker. Empty groups are left out.
 */
export function groupAssets(assets: readonly CatalogAsset[]): Array<{ label: string; assets: CatalogAsset[] }> {
  const category = (asset: CatalogAsset) => registeredAsset(asset.id)?.category ?? "crypto";
  return GROUPS.map(([key, label]) => ({ label, assets: assets.filter((asset) => category(asset) === key) })).filter((group) => group.assets.length > 0);
}
