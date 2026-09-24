import { parseAbi, type Address, type PublicClient } from "viem";
import { AAVE_BASE_ASSETS, AAVE_BASE_PROTOCOL, AAVE_BASE_V3_MARKET } from "./aave";
import type { AaveRiskInput } from "./aave-risk-gate";

// Aave V3 Base address book and Aave V3 Pool/DataProvider/Oracle interfaces.
const ADDRESSES = AAVE_BASE_PROTOCOL;
const ABI = parseAbi([
  "function getPool() view returns (address)",
  "function getPriceOracle() view returns (address)",
  "function getPoolDataProvider() view returns (address)",
  "function getReservesList() view returns (address[])",
  "function getUserAccountData(address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256)",
  "function getUserEMode(address user) view returns (uint256)",
  "function getReserveNormalizedIncome(address asset) view returns (uint256)",
  "function getReserveNormalizedVariableDebt(address asset) view returns (uint256)",
  "function getReserveConfigurationData(address asset) view returns (uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool)",
  "function getReserveCaps(address asset) view returns (uint256,uint256)",
  "function getPaused(address asset) view returns (bool)",
  "function getReserveData(address asset) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)",
  "function getReserveTokensAddresses(address asset) view returns (address,address,address)",
  "function getUserReserveData(address asset,address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40,bool)",
  "function getDebtCeiling(address asset) view returns (uint256)",
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
  "function getAssetPrice(address asset) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)"
]);

type Request = Pick<AaveRiskInput, "action" | "amountRaw" | "nowMs" | "maxAgeMs" | "minHealthFactorWad"> & {
  user: string; asset: string;
};

function uint(value: unknown, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n) throw new Error(`Incomplete Aave ${label}.`);
  return value;
}
function flag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Incomplete Aave ${label}.`);
  return value;
}
function tuple(value: unknown, length: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`Incomplete Aave ${label}.`);
  return value;
}
function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !/^0x[\da-f]{40}$/i.test(value) || /^0x0{40}$/i.test(value))
    throw new Error(`Invalid Aave ${label}.`);
  return value as Address;
}
function remaining(cap: bigint, used: bigint, decimals: number): bigint | null {
  if (cap === 0n) return null;
  const ceiling = cap * 10n ** BigInt(decimals);
  return ceiling > used ? ceiling - used : 0n;
}
function rayUnit(index: bigint): bigint {
  return (index + 10n ** 27n - 1n) / 10n ** 27n;
}

/** Reads a disconnected, same-block risk input. No plan, simulation, or signing authority. */
export async function readAaveBaseRiskSnapshot(client: PublicClient, request: Request): Promise<AaveRiskInput & {
  wallet: { balanceRaw: bigint; poolAllowanceRaw: bigint };
}> {
  if (await client.getChainId() !== 8453) throw new Error("Aave Base chain mismatch.");
  const user = address(request.user, "user");
  const asset = address(request.asset, "asset");
  if (!Object.values(AAVE_BASE_ASSETS).some((governed) => governed.toLowerCase() === asset.toLowerCase()))
    throw new Error("Unsupported Aave governed asset.");
  const block = await client.getBlock({ blockTag: "latest" });
  if (!block.number || !block.hash || !/^0x[\da-f]{64}$/i.test(block.hash) || block.hash === `0x${"0".repeat(64)}`)
    throw new Error("Aave canonical block unavailable.");
  const blockNumber = block.number;
  const read = async (target: Address, functionName: string, args: readonly unknown[] = []): Promise<unknown> =>
    client.readContract({ address: target, abi: ABI, functionName, args,
      blockHash: block.hash, requireCanonical: true } as never);

  const activePool = address(await read(ADDRESSES.provider, "getPool"), "Pool");
  if (activePool.toLowerCase() !== AAVE_BASE_V3_MARKET.toLowerCase()) throw new Error("Aave Pool address changed.");
  const activeOracle = address(await read(ADDRESSES.provider, "getPriceOracle"), "oracle");
  if (activeOracle.toLowerCase() !== ADDRESSES.oracle.toLowerCase()) throw new Error("Aave oracle address changed.");
  const activeDataProvider = address(await read(ADDRESSES.provider, "getPoolDataProvider"), "data provider");
  if (activeDataProvider.toLowerCase() !== ADDRESSES.dataProvider.toLowerCase()) throw new Error("Aave data provider address changed.");
  const reserves = await read(activePool, "getReservesList");
  if (!Array.isArray(reserves) || reserves.length === 0 || reserves.length > 128)
    throw new Error("Aave reserve coverage unavailable.");
  const reserveAddresses = reserves.map((value) => address(value, "reserve"));
  if (new Set(reserveAddresses.map((value) => value.toLowerCase())).size !== reserveAddresses.length
    || !reserveAddresses.some((value) => value.toLowerCase() === asset.toLowerCase()))
    throw new Error("Aave governed reserve unavailable.");

  const account = tuple(await read(activePool, "getUserAccountData", [user]), 6, "account data");
  const eMode = uint(await read(activePool, "getUserEMode", [user]), "eMode");
  if (eMode > 255n) throw new Error("Invalid Aave eMode.");
  let allDebtAbsentProven = true;
  let isolationMode = false;
  let selectedUser: readonly unknown[] | undefined;
  for (const reserve of reserveAddresses) {
    const position = tuple(await read(ADDRESSES.dataProvider, "getUserReserveData", [reserve, user]), 9, "reserve position");
    const stableDebt = uint(position[1], "stable debt");
    const variableDebt = uint(position[2], "variable debt");
    if (stableDebt > 0n || variableDebt > 0n) allDebtAbsentProven = false;
    if (flag(position[8], "collateral use")) {
      const ceiling = uint(await read(ADDRESSES.dataProvider, "getDebtCeiling", [reserve]), "debt ceiling");
      if (ceiling > 0n) isolationMode = true;
    }
    if (reserve.toLowerCase() === asset.toLowerCase()) selectedUser = position;
  }
  if (!selectedUser) throw new Error("Aave selected reserve position unavailable.");
  const debtBase = uint(account[1], "base debt");
  if ((debtBase === 0n) !== allDebtAbsentProven) throw new Error("Aave raw debt and aggregate debt are inconsistent.");
  const totalCollateralBase = uint(account[0], "collateral value");
  const threshold = uint(account[3], "liquidation threshold");
  if (threshold > 10_000n) throw new Error("Invalid Aave liquidation threshold.");
  const configuration = tuple(await read(ADDRESSES.dataProvider, "getReserveConfigurationData", [asset]), 10, "reserve configuration");
  const decimalsBig = uint(configuration[0], "decimals");
  const liquidationThreshold = uint(configuration[2], "reserve threshold");
  if (decimalsBig > 36n || liquidationThreshold > 10_000n) throw new Error("Invalid Aave reserve configuration.");
  if (flag(selectedUser[8], "collateral use") && !flag(configuration[5], "collateral configuration"))
    throw new Error("Aave collateral configuration is inconsistent.");
  const decimals = Number(decimalsBig);
  const caps = tuple(await read(ADDRESSES.dataProvider, "getReserveCaps", [asset]), 2, "caps");
  const data = tuple(await read(ADDRESSES.dataProvider, "getReserveData", [asset]), 12, "reserve data");
  const tokens = tuple(await read(ADDRESSES.dataProvider, "getReserveTokensAddresses", [asset]), 3, "reserve tokens");
  const aToken = address(tokens[0], "aToken");
  const price = uint(await read(ADDRESSES.oracle, "getAssetPrice", [asset]), "oracle price");
  const baseCurrencyUnit = uint(await read(ADDRESSES.oracle, "BASE_CURRENCY_UNIT"), "base currency unit");
  if (baseCurrencyUnit !== 100_000_000n || price === 0n) throw new Error("Aave oracle base or price unavailable.");
  const liquidity = uint(await read(asset, "balanceOf", [aToken]), "available liquidity");
  const walletBalance = uint(await read(asset, "balanceOf", [user]), "wallet balance");
  const poolAllowance = uint(await read(asset, "allowance", [user, activePool]), "Pool allowance");
  const paused = flag(await read(ADDRESSES.dataProvider, "getPaused", [asset]), "paused flag");
  const supplyCap = uint(caps[1], "supply cap");
  const borrowCap = uint(caps[0], "borrow cap");
  const liquidityIndex = uint(data[9], "liquidity index");
  const variableBorrowIndex = uint(data[10], "variable borrow index");
  const normalizedIncome = uint(await read(activePool, "getReserveNormalizedIncome", [asset]), "normalized income");
  const normalizedVariableDebt = uint(await read(activePool, "getReserveNormalizedVariableDebt", [asset]), "normalized variable debt");
  if (liquidityIndex < 10n ** 27n || variableBorrowIndex < 10n ** 27n
    || normalizedIncome < liquidityIndex || normalizedVariableDebt < variableBorrowIndex)
    throw new Error("Invalid Aave reserve index.");
  const treasuryUnderlying = (uint(data[1], "treasury accrual") * normalizedIncome + 10n ** 27n - 1n) / 10n ** 27n;
  // Aave cap validation works on scaled totals at the next index; reserve a few index-units
  // for conversion rounding. A fresh recheck remains mandatory immediately before signing.
  const supplyUsed = uint(data[2], "aToken supply")
    + treasuryUnderlying + 3n * rayUnit(normalizedIncome);
  const borrowUsed = uint(data[3], "stable reserve debt") + uint(data[4], "variable reserve debt")
    + 3n * rayUnit(normalizedVariableDebt);
  const canonical = await client.getBlock({ blockNumber });
  if (canonical.hash?.toLowerCase() !== block.hash.toLowerCase() || canonical.timestamp !== block.timestamp)
    throw new Error("Aave canonical block changed during snapshot.");
  const observedAtMs = Number(block.timestamp) * 1_000;
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs > request.nowMs || request.nowMs - observedAtMs > request.maxAgeMs)
    throw new Error("Aave snapshot is stale or invalid.");
  return {
    action: request.action, amountRaw: request.amountRaw, nowMs: request.nowMs,
    maxAgeMs: request.maxAgeMs, minHealthFactorWad: request.minHealthFactorWad,
    snapshot: { blockNumber, blockHash: block.hash, observedAtMs, complete: true },
    wallet: { balanceRaw: walletBalance, poolAllowanceRaw: poolAllowance },
    reserve: {
      decimals, priceBase: price, liquidationThresholdBps: Number(liquidationThreshold),
      active: flag(configuration[8], "active flag"), paused,
      frozen: flag(configuration[9], "frozen flag"), borrowingEnabled: flag(configuration[6], "borrowing flag"),
      collateralEnabledForUser: flag(selectedUser[8], "collateral use"), availableLiquidityRaw: liquidity,
      supplyCapRemainingRaw: remaining(supplyCap, supplyUsed, decimals),
      borrowCapRemainingRaw: remaining(borrowCap, borrowUsed, decimals)
    },
    account: {
      weightedCollateralBase: totalCollateralBase * threshold / 10_000n,
      debtBase, availableBorrowsBase: uint(account[2], "available borrows"),
      assetCollateralBalanceRaw: uint(selectedUser[0], "aToken balance"), variableDebtRaw: uint(selectedUser[2], "variable debt"),
      allDebtAbsentProven, eModeCategory: Number(eMode), isolationMode
    }
  };
}
