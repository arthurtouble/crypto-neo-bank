import { assetId, parseAssetId, type AssetId } from "@/lib/swap/assets";

const ETH = assetId(8453, null);
const USDC = assetId(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

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
