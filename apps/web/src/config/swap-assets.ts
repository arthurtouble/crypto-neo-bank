export const SWAP_ASSETS = {
  ETH: { id: "ETH", symbol: "ETH", name: "Ether", decimals: 18, address: "0x0000000000000000000000000000000000000000" },
  USDC: { id: "USDC", symbol: "USDC", name: "USD Coin", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  WETH: { id: "WETH", symbol: "WETH", name: "Wrapped Ether", decimals: 18, address: "0x4200000000000000000000000000000000000006" },
  cbBTC: { id: "cbBTC", symbol: "cbBTC", name: "Coinbase Wrapped Bitcoin", decimals: 8, address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" },
  WBTC: { id: "WBTC", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" },
  cbETH: { id: "cbETH", symbol: "cbETH", name: "Coinbase Wrapped Staked ETH", decimals: 18, address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22" },
  wstETH: { id: "wstETH", symbol: "wstETH", name: "Wrapped Staked ETH", decimals: 18, address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452" },
  EURC: { id: "EURC", symbol: "EURC", name: "Euro Coin", decimals: 6, address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42" },
  DAI: { id: "DAI", symbol: "DAI", name: "Dai", decimals: 18, address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb" },
  USDS: { id: "USDS", symbol: "USDS", name: "USDS", decimals: 18, address: "0x820C137fa70C8691f0e44Dc420a5e53c168921Dc" },
  LINK: { id: "LINK", symbol: "LINK", name: "Chainlink", decimals: 18, address: "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196" },
  AAVE: { id: "AAVE", symbol: "AAVE", name: "Aave", decimals: 18, address: "0x63706e401c06ac8513145b7687A14804d17f814b" }
} as const;

export const SWAP_ASSET_IDS = Object.keys(SWAP_ASSETS) as [keyof typeof SWAP_ASSETS, ...(keyof typeof SWAP_ASSETS)[]];
export type SwapAssetId = keyof typeof SWAP_ASSETS;
export type SwapAsset = (typeof SWAP_ASSETS)[SwapAssetId];

export const NATIVE_ASSET_ADDRESS = SWAP_ASSETS.ETH.address;
export const SWAP_CHAIN_ID = 8453;
