// No runtime imports: scripts/check-assets.mjs loads this file directly in Node.

/**
 * Every asset Aura supports, and what each may be used for. Nothing outside
 * this list can be shown, deposited, sent, swapped, or bought, in the app or
 * through the API. Assets are identified by network and contract, never by
 * ticker.
 *
 * To add an asset, add an entry here in a reviewed pull request and run
 * `pnpm assets:check` against the live chains. To stop new money movement in
 * an asset right away, pause it in the operations console (see
 * docs/architecture/assets.md); pausing never hides what a customer holds.
 */

/** How an asset is grouped in the Overview. */
type AssetCategory = "cash" | "crypto" | "stock" | "metal";

/**
 * What an asset may be used for.
 * - hold: read and shown in the Overview. The account holds funds on Base; an asset
 *   that only exists on another network (Tether Gold on Ethereum) is held there, at the same address.
 * - deposit: added from a connected wallet on its network (bridged to Base if needed).
 * - send: sent from the Aura account.
 * - swap: bought or sold in Swap, or received on another network.
 */
export type AssetUse = "hold" | "deposit" | "send" | "swap";

/**
 * How the US dollar value is read, for totals and daily limits.
 * - usd: a dollar stablecoin, counted at $1.
 * - kraken: a fresh one-minute Kraken candle.
 * - chainlink: a Chainlink feed on Base, in dollars per whole token. Stock and
 *   forex feeds pause outside market hours and hold the last value, so a feed
 *   may be up to `maxAgeSeconds` old; older than that, the value is unavailable.
 */
export type PriceSource = { kind: "usd" } | { kind: "kraken"; market: "eth" | "btc" }
  | { kind: "chainlink"; feed: `0x${string}`; decimals: number; maxAgeSeconds: number; label: string };

export type RegisteredAsset = {
  /** `<chainId>:<lowercase contract>` or `<chainId>:native`. */
  id: string;
  chainId: number;
  address: `0x${string}` | null;
  symbol: string;
  name: string;
  decimals: number;
  category: AssetCategory;
  price: PriceSource;
  uses: readonly AssetUse[];
  /** For a bridged or wrapped asset, what it represents. Shown to customers. */
  note?: string;
};

/** Base, where the account holds funds. */
export const BASE_CHAIN_ID = 8453 as const;
/** Circle's USDC on Base, lowercased. */
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

const BASE = BASE_CHAIN_ID;
const ETHEREUM = 1;
const ARBITRUM = 42161;
const OPTIMISM = 10;
const POLYGON = 137;

/** The networks Aura supports. Base is where the account holds funds; the others are for deposits and sends. */
export const NETWORKS = [
  { chainId: BASE, name: "Base" },
  { chainId: ETHEREUM, name: "Ethereum" },
  { chainId: ARBITRUM, name: "Arbitrum" },
  { chainId: OPTIMISM, name: "Optimism" },
  { chainId: POLYGON, name: "Polygon" }
] as const;

export function networkName(chainId: number): string {
  return NETWORKS.find((network) => network.chainId === chainId)?.name ?? `Network ${chainId}`;
}

/**
 * Where a Base asset can be sent: Base itself, and every other network where
 * the same asset is registered to be received ("swap"). Sending elsewhere goes
 * through a LI.FI route, with its fees taken from the amount.
 */
export function sendDestinations(assetId: string): Array<{ chainId: number; name: string; asset: RegisteredAsset }> {
  const source = assetFor(assetId, "send");
  if (!source) return [];
  return NETWORKS.flatMap((network) => {
    const asset = network.chainId === source.chainId ? source
      : ASSETS.find((item) => item.chainId === network.chainId && item.symbol === source.symbol && item.uses.includes("swap"));
    return asset ? [{ chainId: network.chainId, name: network.name, asset }] : [];
  });
}

const usd: PriceSource = { kind: "usd" };
const ether: PriceSource = { kind: "kraken", market: "eth" };
const bitcoin: PriceSource = { kind: "kraken", market: "btc" };
/** Weekends and a holiday Monday: a market-hours feed can hold Friday's close for up to four days. */
const MARKET_HOURS_MAX_AGE = 4 * 24 * 3600;
const chainlink = (feed: string, label: string): PriceSource =>
  ({ kind: "chainlink", feed: feed.toLowerCase() as `0x${string}`, decimals: 8, maxAgeSeconds: MARKET_HOURS_MAX_AGE, label });

/**
 * Coinbase tokenized stocks on Base (B20 tokens, 8 decimals). One token isn't
 * permanently one share: dividends and splits change a multiplier. Each feed
 * reports the token's total-return value (share price × multiplier), so a
 * token amount × the feed price is its dollar value. Only for persons in
 * eligible places outside the US (Coinbase's terms).
 */
const STOCKS: ReadonlyArray<[symbol: string, name: string, address: string, feed: string]> = [
  ["AAPLc", "Apple", "0xb200000000000000000000c2e324d24d7eecd1fb", "0x787f13dea48db0897cbcdd985de77809d837f988"],
  ["AMZNc", "Amazon", "0xb200000000000000000000d9192b6b456483c2e8", "0x06a8e4b3abb3b7543d8396fb2b763d22820cb295"],
  ["GOOGLc", "Alphabet", "0xb2000000000000000000002d0ba3164cc74f58b7", "0x5bf49e0ffa937ce2fff033c739ad7c634c4d34f2"],
  ["METAc", "Meta Platforms", "0xb2000000000000000000008bc8786b856e61707c", "0x6526ae6797a76123638b863aee4dd27ba4e4b27d"],
  ["MSFTc", "Microsoft", "0xb200000000000000000000ab99cfa739e253872b", "0xeb10a6c9aa7e537aed766c08c35dae35b321b18c"],
  ["MSTRc", "Strategy", "0xb2000000000000000000004884b426556b92883d", "0xb3ce282cd188b35da0e38d8bc7d58e33173d202a"],
  ["NVDAc", "NVIDIA", "0xb20000000000000000000078ee7ce2fe4908108c", "0x04689a41629776563e6822f76f2e57d148d28513"],
  ["SNDKc", "Sandisk", "0xb200000000000000000000397293cb8cda9a10c5", "0x388b0dc46c0fb05a74bee0994fa5b02c6fcca2ea"],
  ["SPCXc", "SpaceX", "0xb2000000000000000000007b9fcbd005511acbd5", "0x6a634b235903c4ad6376892180d6ff8612e3fa68"],
  ["TSLAc", "Tesla", "0xb2000000000000000000001e800a7f5189430cd0", "0xfaf869185383a24f8cb00e27bda6b63b9905dcb4"]
];

function asset(chainId: number, address: `0x${string}` | null, details: Omit<RegisteredAsset, "id" | "chainId" | "address">): RegisteredAsset {
  const contract = address?.toLowerCase() as `0x${string}` | undefined;
  return { id: `${chainId}:${contract ?? "native"}`, chainId, address: contract ?? null, ...details };
}

export const ASSETS: readonly RegisteredAsset[] = [
  // Base: where the Aura account holds funds.
  asset(BASE, null, { symbol: "ETH", name: "Ether", decimals: 18, category: "crypto", price: ether, uses: ["hold", "deposit", "send", "swap"] }),
  asset(BASE, BASE_USDC, { symbol: "USDC", name: "USD Coin", decimals: 6, category: "cash", price: usd, uses: ["hold", "deposit", "send", "swap"] }),
  asset(BASE, "0x4200000000000000000000000000000000000006", { symbol: "WETH", name: "Wrapped Ether", decimals: 18, category: "crypto", price: ether, uses: ["hold", "send", "swap"] }),
  asset(BASE, "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", { symbol: "cbBTC", name: "Bitcoin (Coinbase Wrapped BTC)", decimals: 8, category: "crypto", price: bitcoin,
    uses: ["hold", "send", "swap"], note: "Bitcoin held by Coinbase, 1:1" }),
  asset(BASE, "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", { symbol: "EURC", name: "Euro Coin", decimals: 6, category: "cash",
    price: chainlink("0xc91d87e81fab8f93699ecf7ee9b44d11e1d53f0f", "EUR / USD"), uses: ["hold", "deposit", "send", "swap"], note: "Euro stablecoin issued by Circle" }),
  ...STOCKS.map(([symbol, name, address, feed]) => asset(BASE, address as `0x${string}`, { symbol, name, decimals: 8, category: "stock",
    price: chainlink(feed, `Coinbase ${symbol.slice(0, -1)}`), uses: ["hold", "send", "swap"], note: `${name} stock, tokenized by Coinbase` })),

  // Ethereum: Tether Gold isn't issued on Base, so the account holds it on Ethereum at the same address.
  // One XAUt is one troy ounce of gold, valued with Chainlink's gold price.
  asset(ETHEREUM, "0x68749665ff8d2d112fa859aa293f07a622782f38", { symbol: "XAUt", name: "Tether Gold", decimals: 6, category: "metal",
    price: chainlink("0x5213ebb69743b85644dbb6e25cdf994afbb8cf31", "XAU / USD"), uses: ["hold", "send", "swap"],
    note: "One troy ounce of gold, held on Ethereum" }),

  // Other networks: deposit sources, and destinations for sending to another network.
  asset(ETHEREUM, null, { symbol: "ETH", name: "Ether", decimals: 18, category: "crypto", price: ether, uses: ["deposit", "swap"] }),
  asset(ETHEREUM, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", { symbol: "USDC", name: "USD Coin", decimals: 6, category: "cash", price: usd, uses: ["deposit", "swap"] }),
  asset(ARBITRUM, null, { symbol: "ETH", name: "Ether", decimals: 18, category: "crypto", price: ether, uses: ["deposit", "swap"] }),
  asset(ARBITRUM, "0xaf88d065e77c8cc2239327c5edb3a432268e5831", { symbol: "USDC", name: "USD Coin", decimals: 6, category: "cash", price: usd, uses: ["deposit", "swap"] }),
  asset(OPTIMISM, null, { symbol: "ETH", name: "Ether", decimals: 18, category: "crypto", price: ether, uses: ["deposit", "swap"] }),
  asset(OPTIMISM, "0x0b2c639c533813f4aa9d7837caf62653d097ff85", { symbol: "USDC", name: "USD Coin", decimals: 6, category: "cash", price: usd, uses: ["deposit", "swap"] }),
  // Native USDC only; bridged variants such as USDC.e are not accepted. Polygon's native coin is POL, so only USDC comes from Polygon.
  asset(POLYGON, "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", { symbol: "USDC", name: "USD Coin", decimals: 6, category: "cash", price: usd, uses: ["deposit", "swap"] })
];

const byId = new Map(ASSETS.map((item) => [item.id, item]));

/** A registered asset by ID, whatever its uses. */
export function registeredAsset(id: string): RegisteredAsset | null {
  return byId.get(id.toLowerCase()) ?? null;
}

/** A registered asset allowed for a use. Pausing is checked separately (`lib/assets/pauses.ts`). */
export function assetFor(id: string, use: AssetUse): RegisteredAsset | null {
  const found = registeredAsset(id);
  return found && found.uses.includes(use) ? found : null;
}

/** Every registered asset allowed for a use, optionally on one network. */
export function assetsFor(use: AssetUse, chainId?: number): RegisteredAsset[] {
  return ASSETS.filter((item) => item.uses.includes(use) && (chainId === undefined || item.chainId === chainId));
}
