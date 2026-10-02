import { BASE_CHAIN_ID, networkName } from "@/lib/assets/registry";
import { formatToken, fromRaw } from "@/lib/format";
import type { CatalogAsset } from "./assets";

export function assetNetwork(chainId: number): string { return networkName(chainId); }

/**
 * One line in Swap's asset dropdown: "USDC · USD Coin", the network when it isn't the account's own,
 * what the account holds on the side that pays, and "paused" when it can't be chosen.
 */
export function optionLabel(asset: CatalogAsset, heldRaw?: string | null): string {
  const network = asset.chainId === BASE_CHAIN_ID ? "" : ` on ${assetNetwork(asset.chainId)}`;
  const held = heldRaw === undefined ? "" : heldRaw === null ? " · balance unavailable" : ` · ${formatToken(fromRaw(heldRaw, asset.decimals))} available`;
  return `${asset.symbol} · ${asset.name}${network}${held}${asset.eligibility === "eligible" ? "" : " · paused"}`;
}

/** The side that pays: what the account holds comes first, in registry order, then the rest. */
export function heldFirst(assets: readonly CatalogAsset[], held: ReadonlyMap<string, string | null>): CatalogAsset[] {
  const has = (asset: CatalogAsset) => { const raw = held.get(asset.id); return raw ? BigInt(raw) > 0n : false; };
  return [...assets.filter(has), ...assets.filter((asset) => !has(asset))];
}
