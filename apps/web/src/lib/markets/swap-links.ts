import { assetId, parseAssetId, type AssetId } from "@/lib/swap/assets";

const ETH = assetId(8453, null);
const USDC = assetId(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

// Kraken's price identity is not an execution identity. Every entry is reviewed
// against one specific contract; a matching ticker never creates a Swap link.
const marketAssets: Readonly<Record<string, { symbol: string; assetId: AssetId }>> = {
  "eth-usd": { symbol: "eth", assetId: ETH },
  "usdc-usd": { symbol: "usdc", assetId: USDC }
};

export function marketSwapAssetId(market: { id: string; symbol: string }): AssetId | null {
  const mapped = marketAssets[market.id];
  return mapped && mapped.symbol === market.symbol.toLowerCase() ? mapped.assetId : null;
}

function validAsset(value: string | null | undefined): AssetId | null {
  return value && parseAssetId(value) ? value : null;
}

export function parseSwapDeepLink(parameters: { from?: string | null; to?: string | null }): { fromAssetId: AssetId; toAssetId: AssetId } {
  const requestedFrom = validAsset(parameters.from);
  const requestedTo = validAsset(parameters.to);
  const toAssetId = requestedTo ?? (requestedFrom === ETH ? USDC : ETH);
  const fromAssetId = requestedFrom && requestedFrom !== toAssetId ? requestedFrom : toAssetId === USDC ? ETH : USDC;
  return { fromAssetId, toAssetId };
}
