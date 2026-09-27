// No imports: scripts/mainnet-readiness.mjs loads this file directly in Node.

/** Aave V3's governed Base market, its protocol contracts, and the reserves Aura uses. */
export const AAVE_BASE_V3_MARKET = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
export const AAVE_BASE_PROTOCOL = {
  provider: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
  dataProvider: "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A",
  oracle: "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156"
} as const;
export const AAVE_BASE_ASSETS = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  WETH: "0x4200000000000000000000000000000000000006"
} as const;
