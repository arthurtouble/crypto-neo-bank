import { base } from "viem/chains";
import { assetsFor, NETWORKS, type RegisteredAsset } from "@/lib/assets/registry";

/**
 * Where a customer can deposit from, and what arrives on Base. Deposits keep
 * the asset: ETH arrives as ETH and USDC as USDC, so balances stay on one
 * chain without the customer changing what they hold. Which assets qualify is
 * the registry's "deposit" use (lib/assets/registry.ts).
 */
export type DepositSymbol = string;

export const DEPOSIT_NETWORKS = NETWORKS;

export function depositSymbols(chainId: number): DepositSymbol[] {
  return assetsFor("deposit", chainId).map((asset) => asset.symbol);
}

export function depositSource(chainId: number, symbol: DepositSymbol): RegisteredAsset | null {
  return assetsFor("deposit", chainId).find((asset) => asset.symbol === symbol) ?? null;
}

/** The same asset on Base, where every deposit lands. */
export function depositDestination(symbol: DepositSymbol): RegisteredAsset | null {
  return assetsFor("hold", base.id).find((asset) => asset.symbol === symbol) ?? null;
}
