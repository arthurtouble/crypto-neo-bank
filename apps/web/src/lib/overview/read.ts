import { createPublicClient, erc20Abi, fallback, getAddress, http, parseAbi, type PublicClient } from "viem";
import { base, mainnet } from "viem/chains";
import { krakenUsd } from "@/lib/actions/valuation";
import { rpcEndpoints } from "@/lib/actions/chain";
import { AAVE_BASE_ASSETS, AAVE_BASE_V3_MARKET } from "@/lib/defi/aave";
import { SKY_SUSDS, skyVaultAbi } from "@/lib/defi/sky-call-policy";
import { cashAssets, investAssets } from "@/lib/invest/catalog";

export type HoldingGroup = "cash" | "vaults" | "portfolio";

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
  /** Per group: the sum of observed values, and whether any read in the group was unavailable. */
  totals: Record<HoldingGroup, { usdCents: number; partial: boolean }>;
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
 * Read the customer's cash, vaults, and portfolio from the chains. Each
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
  const token = (address: string) => () => clients.base.readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  const tasks: Array<Promise<Holding | null>> = [
    ...cashAssets.map((asset) => read(asset.assetId, "cash", asset.name, asset.symbol, asset.decimals, "base", token(asset.assetId.split(":")[1]), par, true)),
    ...investAssets.map((asset) => read(asset.assetId, "portfolio", asset.name, asset.symbol, asset.decimals, "base",
      asset.assetId === "8453:native" ? () => clients.base.getBalance({ address: owner }) : token(asset.assetId.split(":")[1]),
      () => clients.price(asset.pricing === "kraken:btc" ? "btc" : "eth"))),
    ...Object.entries(AAVE_BASE_ASSETS).map(([symbol, asset]) => read(`aave:8453:${asset.toLowerCase()}`, "vaults", `Aave ${symbol}`, symbol,
      symbol === "USDC" ? 6 : 18, "aave:base", async () => {
        const reserve = await clients.base.readContract({ address: AAVE_BASE_V3_MARKET, abi: poolAbi, functionName: "getReserveData", args: [asset] });
        return clients.base.readContract({ address: reserve.aTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
      }, symbol === "USDC" ? par : () => clients.price("eth"))),
    read("sky:1:susds", "vaults", "Sky savings", "USDS", 18, "sky:ethereum", async () => {
      const shares = await clients.ethereum.readContract({ address: SKY_SUSDS, abi: skyVaultAbi, functionName: "balanceOf", args: [owner] });
      return shares === 0n ? 0n : clients.ethereum.readContract({ address: SKY_SUSDS, abi: skyVaultAbi, functionName: "convertToAssets", args: [shares] });
    }, par)
  ];
  const holdings = (await Promise.all(tasks)).filter((item): item is Holding => item !== null);
  const totals = { cash: { usdCents: 0, partial: false }, vaults: { usdCents: 0, partial: false }, portfolio: { usdCents: 0, partial: false } };
  for (const holding of holdings) {
    if (holding.usdCents === null) totals[holding.group].partial = true;
    else totals[holding.group].usdCents += holding.usdCents;
  }
  return { wallet: owner.toLowerCase(), holdings, totals, observedAt };
}
