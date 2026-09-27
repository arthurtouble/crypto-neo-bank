import { networkName } from "@/lib/assets/registry";
import type { CatalogAsset } from "./assets";

export function assetNetwork(chainId: number): string { return networkName(chainId); }
export function assetCaption(asset: CatalogAsset): string { return `${asset.name} · ${assetNetwork(asset.chainId)}`; }
export function contractHint(asset: CatalogAsset): string {
  return asset.address ? `${asset.address.slice(0, 6)}…${asset.address.slice(-4)}` : "Native asset";
}
