import type { CatalogAsset } from "./assets";

const networks: Readonly<Record<number, string>> = {
  1: "Ethereum", 10: "Optimism", 137: "Polygon", 8453: "Base", 42161: "Arbitrum"
};

export function assetNetwork(chainId: number): string { return networks[chainId] ?? "Unknown network"; }
export function assetCaption(asset: CatalogAsset): string { return `${asset.name} · ${assetNetwork(asset.chainId)}`; }
export function contractHint(asset: CatalogAsset): string {
  return asset.address ? `${asset.address.slice(0, 6)}…${asset.address.slice(-4)}` : "Native asset";
}
export function needsRiskConfirmation(asset: CatalogAsset): boolean {
  return asset.verification !== "verified" || asset.eligibility !== "eligible";
}
