import { assetId, parseAssetId, type AssetId } from "@/lib/swap/assets";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";

const ETH = assetId(BASE_CHAIN_ID, null);
const USDC = assetId(BASE_CHAIN_ID, BASE_USDC);

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
