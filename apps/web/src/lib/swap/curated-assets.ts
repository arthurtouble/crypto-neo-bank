import { CATALOG_REGISTRY } from "./catalog-registry";
import type { AssetId } from "./assets";

export type CuratedAsset = { id: AssetId; chainId: number; address: string | null; symbol: string; name: string; decimals: number; network: string };

const native = (chainId: number, network: string): CuratedAsset => ({ id: `${chainId}:native`, chainId, address: null, symbol: chainId === 137 ? "POL" : "ETH", name: chainId === 137 ? "POL" : "Ether", decimals: 18, network });
const usdc = (chainId: number, address: string, network: string): CuratedAsset => ({ id: `${chainId}:${address}`, chainId, address, symbol: "USDC", name: "USD Coin", decimals: 6, network });

export const CURATED_SWAP_ASSETS: readonly CuratedAsset[] = [
  native(8453, "Base"),
  usdc(8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "Base"),
  { id: "8453:0x4200000000000000000000000000000000000006", chainId: 8453, address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", decimals: 18, network: "Base" },
  native(1, "Ethereum"), usdc(1, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "Ethereum"),
  native(42161, "Arbitrum"), usdc(42161, "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "Arbitrum"),
  native(10, "Optimism"), usdc(10, "0x0b2c639c533813f4aa9d7837caf62653d097ff85", "Optimism"),
  native(137, "Polygon"), usdc(137, "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", "Polygon")
].filter((asset) => CATALOG_REGISTRY.verified.has(asset.id));

export function curatedSwapAsset(id: string): CuratedAsset | undefined {
  return CURATED_SWAP_ASSETS.find((asset) => asset.id === id);
}
