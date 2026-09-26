import { createPublicClient, erc20Abi, fallback, getAddress, http, parseAbi, type PublicClient } from "viem";
import { base, mainnet } from "viem/chains";
import { krakenUsd } from "@/lib/actions/valuation";
import { rpcEndpoints } from "@/lib/actions/chain";
import { AAVE_BASE_ASSETS, AAVE_BASE_V3_MARKET } from "@/lib/defi/aave";
import { SKY_SUSDS, skyVaultAbi } from "@/lib/defi/sky-call-policy";
import { assetsFor, type PriceSource } from "@/lib/assets/registry";

/** Cash is stablecoins in the account, crypto is other assets in the account, earn is Aave and Sky deposits. */
export type HoldingGroup = "cash" | "crypto" | "earn";

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
};

export type Overview = {
  wallet: string;
  holdings: Holding[];
  /** Per group and overall: the sum of observed values, and whether any read or price was unavailable. */
  totals: Record<HoldingGroup | "all", { usdCents: number; partial: boolean }>;
  observedAt: string;
};

type Clients = { base: PublicClient; ethereum: PublicClient; price: (asset: "eth" | "btc") => Promise<string | null> };

const poolAbi = parseAbi([
  "struct ReserveDataLegacy { uint256 configuration; uint128 liquidityIndex; uint128 currentLiquidityRate; uint128 variableBorrowIndex; uint128 currentVariableBorrowRate; uint128 currentStableBorrowRate; uint40 lastUpdateTimestamp; uint16 id; address aTokenAddress; address stableDebtTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt; }",
  "function getReserveData(address asset) view returns (ReserveDataLegacy)"
]);

function client(chain: typeof base | typeof mainnet): PublicClient {
  return createPublicClient({ chain, transport: fallback(rpcEndpoints(chain.id).map((url) => http(url, { timeout: 8_000, retryCount: 0 }))) }) as PublicClient;
}

export function defaultClients(): Clients {
  const now = new Date();
  const prices = new Map<string, Promise<string | null>>();
  return { base: client(base), ethereum: client(mainnet),
    price: (asset) => { if (!prices.has(asset)) prices.set(asset, krakenUsd(asset, now)); return prices.get(asset)!; } };
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
    amount: () => Promise<bigint>, price: () => Promise<string | null>, keepZero = false): Promise<Holding | null> => {
    try {
      const raw = await amount();
      if (raw === 0n && !keepZero) return null;
      return { id, group, label, symbol, decimals, source, status: "observed", amountRaw: raw.toString(), usdCents: raw === 0n ? 0 : cents(raw, decimals, await price()), observedAt };
    } catch {
      return { id, group, label, symbol, decimals, source, status: "unavailable", amountRaw: null, usdCents: null, observedAt };
    }
  };
  const par = async () => "1";
  const priceOf = (source: PriceSource) => source.kind === "usd" ? par : () => clients.price(source.market);
  const token = (address: string) => () => clients.base.readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  const tasks: Array<Promise<Holding | null>> = [
    // Every registered asset the account can hold on Base. Cash always shows, even at zero.
    ...assetsFor("hold", 8453).map((asset) => read(asset.id, asset.category === "cash" ? "cash" : "crypto", asset.name, asset.symbol, asset.decimals, "base",
      asset.address === null ? () => clients.base.getBalance({ address: owner }) : token(asset.address),
      priceOf(asset.price), asset.category === "cash")),
    ...Object.entries(AAVE_BASE_ASSETS).map(([symbol, asset]) => read(`aave:8453:${asset.toLowerCase()}`, "earn", `Aave ${symbol}`, symbol,
      symbol === "USDC" ? 6 : 18, "aave:base", async () => {
        const reserve = await clients.base.readContract({ address: AAVE_BASE_V3_MARKET, abi: poolAbi, functionName: "getReserveData", args: [asset] });
        return clients.base.readContract({ address: reserve.aTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
      }, symbol === "USDC" ? par : () => clients.price("eth"))),
    read("sky:1:susds", "earn", "Sky savings", "USDS", 18, "sky:ethereum", async () => {
      const shares = await clients.ethereum.readContract({ address: SKY_SUSDS, abi: skyVaultAbi, functionName: "balanceOf", args: [owner] });
      return shares === 0n ? 0n : clients.ethereum.readContract({ address: SKY_SUSDS, abi: skyVaultAbi, functionName: "convertToAssets", args: [shares] });
    }, par)
  ];
  const holdings = (await Promise.all(tasks)).filter((item): item is Holding => item !== null);
  const totals = { cash: { usdCents: 0, partial: false }, crypto: { usdCents: 0, partial: false }, earn: { usdCents: 0, partial: false }, all: { usdCents: 0, partial: false } };
  for (const holding of holdings) {
    for (const total of [totals[holding.group], totals.all]) {
      if (holding.usdCents === null) total.partial = true;
      else total.usdCents += holding.usdCents;
    }
  }
  return { wallet: owner.toLowerCase(), holdings, totals, observedAt };
}
