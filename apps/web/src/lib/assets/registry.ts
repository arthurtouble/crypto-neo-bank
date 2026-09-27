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

/** Where an asset appears: cash in the Overview, or a category in Invest. */
export type AssetCategory = "cash" | "crypto" | "stock" | "metal";

/**
 * What an asset may be used for.
 * - hold: read and shown in the Overview (Base only, where the account holds funds).
 * - deposit: added from a connected wallet on its network (bridged to Base if needed).
 * - send: sent from the Aura account.
 * - swap: bought or sold in Swap, or received on another network.
 * - invest: listed in Invest.
 */
export type AssetUse = "hold" | "deposit" | "send" | "swap" | "invest";

/** How the US dollar value is read, for totals and daily limits. */
export type PriceSource = { kind: "usd" } | { kind: "kraken"; market: "eth" | "btc" };

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

const BASE = 8453;
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

function asset(chainId: number, address: `0x${string}` | null, details: Omit<RegisteredAsset, "id" | "chainId" | "address">): RegisteredAsset {
  const contract = address?.toLowerCase() as `0x${string}` | undefined;
  return { id: `${chainId}:${contract ?? "native"}`, chainId, address: contract ?? null, ...details };
}

export const ASSETS: readonly RegisteredAsset[] = [
  // Base: where the Aura account holds funds.
  asset(BASE, null, { symbol: "ETH", name: "Ether", decimals: 18, category: "crypto", price: ether, uses: ["hold", "deposit", "send", "swap", "invest"] }),
  asset(BASE, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", { symbol: "USDC", name: "USD Coin", decimals: 6, category: "cash", price: usd, uses: ["hold", "deposit", "send", "swap"] }),
  asset(BASE, "0x4200000000000000000000000000000000000006", { symbol: "WETH", name: "Wrapped Ether", decimals: 18, category: "crypto", price: ether, uses: ["hold", "send", "swap"] }),
  asset(BASE, "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", { symbol: "cbBTC", name: "Bitcoin (Coinbase Wrapped BTC)", decimals: 8, category: "crypto", price: bitcoin,
    uses: ["hold", "send", "swap", "invest"], note: "Bitcoin held by Coinbase, 1:1" }),

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
