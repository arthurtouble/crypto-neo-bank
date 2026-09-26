import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import type { CatalogAsset } from "@/lib/swap/assets";

/**
 * Where a customer can deposit from, and what arrives on Base. Deposits keep
 * the asset: ETH arrives as ETH and USDC as USDC, so balances stay on one
 * chain without the customer changing what they hold.
 */
export type DepositSymbol = "ETH" | "USDC";

type SourceAsset = { chainId: number; symbol: DepositSymbol; address: `0x${string}` | null; decimals: number };

export const DEPOSIT_NETWORKS = [
  { chainId: base.id, name: "Base" },
  { chainId: mainnet.id, name: "Ethereum" },
  { chainId: arbitrum.id, name: "Arbitrum" },
  { chainId: optimism.id, name: "Optimism" },
  { chainId: polygon.id, name: "Polygon" }
] as const;

// Native USDC only; bridged variants such as USDC.e are not accepted.
const SOURCE_ASSETS: readonly SourceAsset[] = [
  { chainId: base.id, symbol: "ETH", address: null, decimals: 18 },
  { chainId: base.id, symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
  { chainId: mainnet.id, symbol: "ETH", address: null, decimals: 18 },
  { chainId: mainnet.id, symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
  { chainId: arbitrum.id, symbol: "ETH", address: null, decimals: 18 },
  { chainId: arbitrum.id, symbol: "USDC", address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", decimals: 6 },
  { chainId: optimism.id, symbol: "ETH", address: null, decimals: 18 },
  { chainId: optimism.id, symbol: "USDC", address: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", decimals: 6 },
  // Polygon's native coin is POL, so only USDC comes from Polygon.
  { chainId: polygon.id, symbol: "USDC", address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", decimals: 6 }
];

export function depositSymbols(chainId: number): DepositSymbol[] {
  return SOURCE_ASSETS.filter((asset) => asset.chainId === chainId).map((asset) => asset.symbol);
}

export function depositSource(chainId: number, symbol: DepositSymbol): SourceAsset | null {
  return SOURCE_ASSETS.find((asset) => asset.chainId === chainId && asset.symbol === symbol) ?? null;
}

/** The same asset on Base, where every deposit lands. */
export function depositDestination(symbol: DepositSymbol): SourceAsset {
  return depositSource(base.id, symbol)!;
}

/** A deposit asset in the route module's catalog shape. */
export function asCatalogAsset(asset: SourceAsset): CatalogAsset {
  return {
    id: `${asset.chainId}:${asset.address ?? "native"}`, chainId: asset.chainId, address: asset.address,
    symbol: asset.symbol, name: asset.symbol === "ETH" ? "Ether" : "USD Coin", decimals: asset.decimals,
    logoUrl: null, verification: "verified", eligibility: "eligible"
  };
}
