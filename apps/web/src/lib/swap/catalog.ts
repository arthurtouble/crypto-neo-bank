import { pausedAssets, requireAsset } from "@/lib/assets/pauses";
import { assetsFor, type AssetUse, type RegisteredAsset } from "@/lib/assets/registry";
import type { CatalogAsset } from "@/lib/swap/assets";

/** A registry entry in the shape Swap and LI.FI quoting use. Every catalog asset is a reviewed registry entry. */
export function catalogAsset(asset: RegisteredAsset, pausedReason?: string): CatalogAsset {
  return { id: asset.id, chainId: asset.chainId, address: asset.address, symbol: asset.symbol, name: asset.name, decimals: asset.decimals,
    logoUrl: null, eligibility: pausedReason ? "unavailable" : "eligible",
    ...(pausedReason ? { unavailableReason: `${asset.symbol} is paused right now.` } : {}) };
}

/**
 * The assets that can be swapped on the chosen networks, from the registry
 * only. A search matches symbol, name, or contract; nothing outside the
 * registry is ever offered. Paused assets are listed as unavailable.
 */
export async function getCatalogPage(db: D1Database, input: { query: string; chainIds: readonly number[]; held?: boolean }) {
  const query = input.query.trim().toLowerCase();
  const paused = await pausedAssets(db);
  // "You pay" offers only what the account can hold; "you receive" offers every swappable asset.
  const assets = assetsFor("swap").filter((asset) => input.chainIds.includes(asset.chainId) && (!input.held || asset.uses.includes("hold")) && (!query
    || asset.symbol.toLowerCase().includes(query) || asset.name.toLowerCase().includes(query) || asset.address?.includes(query)));
  return { assets: assets.map((asset) => catalogAsset(asset, paused.get(asset.id))), nextCursor: null, observedAt: new Date().toISOString(), source: "Aura registry" as const };
}

/** A registered, unpaused asset for a use, in catalog shape; refused otherwise. */
export async function requireCatalogAsset(db: D1Database, id: string, use: AssetUse = "swap"): Promise<CatalogAsset> {
  return catalogAsset(await requireAsset(db, id, use));
}
