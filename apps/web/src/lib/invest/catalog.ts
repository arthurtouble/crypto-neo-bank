/**
 * The assets Aura presents for investing, all on Base and bought through the
 * shared LI.FI route module. Each entry is identified by contract, never by
 * ticker. Stocks and metals appear only once an issuer's token is available
 * on Base and its restrictions are reviewed; until then the categories are empty.
 */
export type InvestCategory = "crypto" | "stocks" | "metals";

export type InvestAsset = {
  assetId: string;
  symbol: string;
  name: string;
  decimals: number;
  category: InvestCategory;
  /** Where the price comes from for display and limits. */
  pricing: "kraken:eth" | "kraken:btc";
};

export const investAssets: readonly InvestAsset[] = [
  { assetId: "8453:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", symbol: "cbBTC", name: "Bitcoin (Coinbase Wrapped BTC)", decimals: 8, category: "crypto", pricing: "kraken:btc" },
  { assetId: "8453:native", symbol: "ETH", name: "Ether", decimals: 18, category: "crypto", pricing: "kraken:eth" }
];

export const investCategories: ReadonlyArray<{ key: InvestCategory; label: string; available: boolean; note?: string }> = [
  { key: "crypto", label: "Crypto", available: true },
  { key: "stocks", label: "Stocks", available: false, note: "Tokenized stocks aren't available yet." },
  { key: "metals", label: "Metals", available: false, note: "Tokenized metals aren't available yet." }
];

/** Stablecoins held as cash in the Overview. */
export const cashAssets = [
  { assetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin", decimals: 6 }
] as const;
