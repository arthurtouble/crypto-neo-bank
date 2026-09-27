import { createPublicClient, erc20Abi, fallback, getAddress, http, parseAbi, type PublicClient } from "viem";
import { base, mainnet } from "viem/chains";
import { krakenUsd } from "@/lib/actions/valuation";
import { chainlinkUsd, type FeedPrice } from "@/lib/assets/prices";
import { rpcEndpoints } from "@/lib/actions/chain";
import { AAVE_BASE_ASSETS, AAVE_BASE_V3_MARKET } from "@/lib/defi/aave";
import { MORPHO_VAULTS, vaultAbi } from "@/lib/defi/morpho";
import { assetsFor, type PriceSource } from "@/lib/assets/registry";

/** Cash is stablecoins, then crypto, tokenized stocks, and metals in the account; earn is Aave and Morpho deposits. */
export type HoldingGroup = "cash" | "crypto" | "stocks" | "metals" | "earn";
const GROUP_OF = { cash: "cash", crypto: "crypto", stock: "stocks", metal: "metals" } as const;

/** One balance, with where it came from and when. An unavailable read never shows a number. */
export type Holding = {
  id: string;
  group: HoldingGroup;
  label: string;
  symbol: string;
  decimals: number;
  source: string;
  status: "observed" | "unavailable";
  amountRaw: string | null;
  usdCents: number | null;
  observedAt: string;
  /** When the price was last published, for a feed that pauses outside market hours (stocks, gold, the euro). */
  priceObservedAt?: string;
};

export type Overview = {
  wallet: string;
  holdings: Holding[];
  /** Per group and overall: the sum of observed values, and whether any read or price was unavailable. */
  totals: Record<HoldingGroup | "all", { usdCents: number; partial: boolean }>;
  observedAt: string;
};

type Priced = Exclude<PriceSource, { kind: "usd" }>;
type Clients = { base: PublicClient; ethereum: PublicClient; price: (source: Priced) => Promise<FeedPrice | null> };
const ETHER: Priced = { kind: "kraken", market: "eth" };

const poolAbi = parseAbi([
  "struct ReserveDataLegacy { uint256 configuration; uint128 liquidityIndex; uint128 currentLiquidityRate; uint128 variableBorrowIndex; uint128 currentVariableBorrowRate; uint128 currentStableBorrowRate; uint40 lastUpdateTimestamp; uint16 id; address aTokenAddress; address stableDebtTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt; }",
  "function getReserveData(address asset) view returns (ReserveDataLegacy)"
]);

function client(chain: typeof base | typeof mainnet): PublicClient {
  return createPublicClient({ chain, transport: fallback(rpcEndpoints(chain.id).map((url) => http(url, { timeout: 8_000, retryCount: 0 }))) }) as PublicClient;
}

export function defaultClients(): Clients {
  const now = new Date();
  const baseClient = client(base);
  const prices = new Map<string, Promise<FeedPrice | null>>();
  const fetchPrice = async (source: Priced): Promise<FeedPrice | null> => {
    if (source.kind === "chainlink") return chainlinkUsd(source, now, baseClient);
    const usd = await krakenUsd(source.market, now);
    return usd === null ? null : { usd, observedAt: now.toISOString() };
  };
  return { base: baseClient, ethereum: client(mainnet),
    price: (source) => {
      const key = source.kind === "chainlink" ? source.feed : source.market;
      if (!prices.has(key)) prices.set(key, fetchPrice(source));
      return prices.get(key)!;
    } };
}

function cents(raw: bigint, decimals: number, price: string | null): number | null {
  if (price === null) return null;
  const match = /^(\d+)(?:\.(\d{1,12}))?$/.exec(price);
  if (!match) return null;
  const scale = 10n ** BigInt(match[2]?.length ?? 0);
  const value = raw * BigInt(match[1] + (match[2] ?? "")) * 100n / (10n ** BigInt(decimals) * scale);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

/**
 * Read the customer's cash, crypto, and earn deposits from the chains. Each
 * holding is read independently; one failed read marks only that holding
 * unavailable. Zero balances are left out, except cash, which always shows.
 */
export async function readOverview(wallet: string, clients: Clients = defaultClients(), now = new Date()): Promise<Overview> {
  const owner = getAddress(wallet);
  const observedAt = now.toISOString();
  const read = async (id: string, group: HoldingGroup, label: string, symbol: string, decimals: number, source: string,
    amount: () => Promise<bigint>, price: () => Promise<FeedPrice | null>, keepZero = false): Promise<Holding | null> => {
    try {
      const raw = await amount();
      if (raw === 0n && !keepZero) return null;
      const priced = raw === 0n ? null : await price();
      return { id, group, label, symbol, decimals, source, status: "observed", amountRaw: raw.toString(),
        usdCents: raw === 0n ? 0 : cents(raw, decimals, priced?.usd ?? null), observedAt,
        ...(priced && priced.observedAt !== observedAt ? { priceObservedAt: priced.observedAt } : {}) };
    } catch {
      return { id, group, label, symbol, decimals, source, status: "unavailable", amountRaw: null, usdCents: null, observedAt };
    }
  };
  const par = async (): Promise<FeedPrice> => ({ usd: "1", observedAt });
  const priceOf = (source: PriceSource) => source.kind === "usd" ? par : () => clients.price(source);
  const networks = { 8453: { client: clients.base, source: "base" }, 1: { client: clients.ethereum, source: "ethereum" } } as const;
  const tasks: Array<Promise<Holding | null>> = [
    // Every registered asset the account can hold, on Base and (for assets only issued there) Ethereum. USDC always shows, even at zero.
    ...assetsFor("hold").map((asset) => {
      const network = networks[asset.chainId as keyof typeof networks];
      return read(asset.id, GROUP_OF[asset.category], asset.name, asset.symbol, asset.decimals, network.source,
        asset.address === null ? () => network.client.getBalance({ address: owner })
          : () => network.client.readContract({ address: asset.address!, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
        priceOf(asset.price), asset.symbol === "USDC");
    }),
    ...Object.entries(AAVE_BASE_ASSETS).map(([symbol, asset]) => read(`aave:8453:${asset.toLowerCase()}`, "earn", `Aave ${symbol}`, symbol,
      symbol === "USDC" ? 6 : 18, "aave:base", async () => {
        const reserve = await clients.base.readContract({ address: AAVE_BASE_V3_MARKET, abi: poolAbi, functionName: "getReserveData", args: [asset] });
        return clients.base.readContract({ address: reserve.aTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
      }, symbol === "USDC" ? par : () => clients.price(ETHER))),
    // Morpho vault shares, valued at what they redeem for in USDC.
    ...MORPHO_VAULTS.map((vault) => read(`morpho:8453:${vault.address}`, "earn", vault.name, vault.assetSymbol, vault.assetDecimals, "morpho:base", async () => {
      const shares = await clients.base.readContract({ address: vault.address, abi: vaultAbi, functionName: "balanceOf", args: [owner] });
      return shares === 0n ? 0n : clients.base.readContract({ address: vault.address, abi: vaultAbi, functionName: "convertToAssets", args: [shares] });
    }, par))
  ];
  const holdings = (await Promise.all(tasks)).filter((item): item is Holding => item !== null);
  const totals = Object.fromEntries((["cash", "crypto", "stocks", "metals", "earn", "all"] as const).map((key) => [key, { usdCents: 0, partial: false }])) as Overview["totals"];
  for (const holding of holdings) {
    for (const total of [totals[holding.group], totals.all]) {
      if (holding.usdCents === null) total.partial = true;
      else total.usdCents += holding.usdCents;
    }
  }
  return { wallet: owner.toLowerCase(), holdings, totals, observedAt };
}
