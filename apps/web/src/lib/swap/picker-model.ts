import { networkName } from "@/lib/assets/registry";
import { shortAddress } from "@/lib/money/format";
import type { CatalogAsset } from "./assets";

export function assetNetwork(chainId: number): string { return networkName(chainId); }
export function assetCaption(asset: CatalogAsset): string { return `${asset.name} · ${assetNetwork(asset.chainId)}`; }
export function contractHint(asset: CatalogAsset): string {
  return asset.address ? shortAddress(asset.address) : "Native asset";
}
