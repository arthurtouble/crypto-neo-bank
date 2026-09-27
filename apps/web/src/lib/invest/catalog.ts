import { assetsFor, type AssetCategory } from "@/lib/assets/registry";

/**
 * What Invest offers: the registry's assets with the "invest" use, bought
 * through the shared LI.FI route module. They're on Base, except Tether Gold,
 * which is held on Ethereum. A category with no registered assets shows as
 * not available yet.
 */
export type InvestCategory = "crypto" | "stocks" | "metals";

export type InvestAsset = { assetId: string; chainId: number; symbol: string; name: string; decimals: number; category: InvestCategory; note?: string };

const categoryOf: Partial<Record<AssetCategory, InvestCategory>> = { crypto: "crypto", stock: "stocks", metal: "metals" };

export const investAssets: readonly InvestAsset[] = assetsFor("invest").flatMap((asset) => {
  const category = categoryOf[asset.category];
  return category ? [{ assetId: asset.id, chainId: asset.chainId, symbol: asset.symbol, name: asset.name, decimals: asset.decimals, category, ...(asset.note ? { note: asset.note } : {}) }] : [];
});

const labels: Record<InvestCategory, string> = { crypto: "Crypto", stocks: "Stocks", metals: "Metals" };
const emptyNotes: Record<InvestCategory, string> = { crypto: "Crypto isn't available yet.", stocks: "Tokenized stocks aren't available yet.", metals: "Tokenized metals aren't available yet." };

export const investCategories: ReadonlyArray<{ key: InvestCategory; label: string; available: boolean; note?: string }> =
  (Object.keys(labels) as InvestCategory[]).map((key) => investAssets.some((asset) => asset.category === key)
    ? { key, label: labels[key], available: true } : { key, label: labels[key], available: false, note: emptyNotes[key] });
