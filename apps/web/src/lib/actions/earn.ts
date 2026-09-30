import { erc20Abi, getAddress, parseAbi, type PublicClient } from "viem";
import { z } from "zod";
import { baseClient } from "@/lib/assets/prices";
import { AAVE_BASE_ASSETS, AAVE_BASE_V3_MARKET } from "@/lib/defi/aave";
import { buildAaveBaseCall } from "@/lib/defi/aave-call-policy";
import { MORPHO_VAULTS, morphoDepositCalls, morphoVault, morphoWithdrawCall, vaultAbi } from "@/lib/defi/morpho";
import { ActionInputError, rawAmount } from "./transfer";
import type { BuiltAction, Call } from "./types";

const amount = z.string().regex(/^\d+(\.\d+)?$/).max(40);
export const earnInputSchema = z.discriminatedUnion("protocol", [
  // Withdrawing everything ("all") leaves nothing behind: Aave pays out the whole balance, a Morpho vault redeems every share.
  z.strictObject({ kind: z.literal("earn"), protocol: z.literal("aave"), direction: z.enum(["deposit", "withdraw"]), asset: z.enum(["USDC", "WETH"]),
    amount: z.union([amount, z.literal("all")]) }),
  z.strictObject({ kind: z.literal("earn"), protocol: z.literal("morpho"), direction: z.enum(["deposit", "withdraw"]),
    vault: z.enum(MORPHO_VAULTS.map((vault) => vault.id) as [string, ...string[]]), amount: z.union([amount, z.literal("all")]) })
]);
export type EarnInput = z.infer<typeof earnInputSchema>;

const toCall = (call: { to: string; value: string; data: string }): Call =>
  ({ to: call.to.toLowerCase() as `0x${string}`, value: call.value, data: call.data.toLowerCase() as `0x${string}` });

const aavePoolAbi = parseAbi([
  "struct ReserveDataLegacy { uint256 configuration; uint128 liquidityIndex; uint128 currentLiquidityRate; uint128 variableBorrowIndex; uint128 currentVariableBorrowRate; uint128 currentStableBorrowRate; uint40 lastUpdateTimestamp; uint16 id; address aTokenAddress; address stableDebtTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt; }",
  "function getReserveData(address asset) view returns (ReserveDataLegacy)"
]);

/**
 * Aave V3 on Base. A deposit is an exact approval and supply in one operation. Withdraw all reads the account's
 * aToken balance first, then asks the pool for everything, so no interest is left behind.
 */
async function buildAave(input: Extract<EarnInput, { protocol: "aave" }>, wallet: string, client: PublicClient = baseClient()): Promise<BuiltAction> {
  const decimals = input.asset === "USDC" ? 6 : 18;
  const asset = AAVE_BASE_ASSETS[input.asset];
  if (input.amount === "all") {
    if (input.direction === "deposit") throw new ActionInputError("invalid_amount", "Enter an amount to deposit.");
    const owner = getAddress(wallet);
    const reserve = await client.readContract({ address: AAVE_BASE_V3_MARKET, abi: aavePoolAbi, functionName: "getReserveData", args: [asset] });
    const balance = await client.readContract({ address: reserve.aTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
    if (balance === 0n) throw new ActionInputError("insufficient_balance", `You have no ${input.asset} in Aave.`);
    return {
      kind: "earn", chainId: 8453, calls: [toCall(buildAaveBaseCall({ action: "withdraw", wallet: owner, asset, amountRaw: balance, max: true }))],
      effects: [{ type: "aave_withdraw_all", asset: asset.toLowerCase() as `0x${string}`, minimumRaw: balance.toString() }],
      summary: { protocol: "aave", direction: "withdraw", symbol: input.asset, decimals, amount: "all", amountRaw: balance.toString() },
      countsTowardLimit: false,
      valuation: { assetId: `8453:${asset.toLowerCase()}`, amountRaw: balance.toString(), decimals }
    };
  }
  const amountRaw = rawAmount(input.amount, decimals);
  const identity = { wallet: getAddress(wallet), asset, amountRaw };
  const calls = input.direction === "deposit"
    ? [toCall(buildAaveBaseCall({ action: "approve", ...identity })), toCall(buildAaveBaseCall({ action: "supply", ...identity }))]
    : [toCall(buildAaveBaseCall({ action: "withdraw", ...identity }))];
  return {
    kind: "earn", chainId: 8453, calls,
    effects: [{ type: input.direction === "deposit" ? "aave_supply" : "aave_withdraw", asset: asset.toLowerCase() as `0x${string}`, amountRaw: amountRaw.toString() }],
    summary: { protocol: "aave", direction: input.direction, symbol: input.asset, decimals, amount: input.amount, amountRaw: amountRaw.toString() },
    countsTowardLimit: false,
    valuation: { assetId: `8453:${asset.toLowerCase()}`, amountRaw: amountRaw.toString(), decimals }
  };
}

/**
 * A Morpho vault on Base: an exact USDC approval and ERC-4626 deposit, or a
 * withdrawal of an exact amount or of every share. The vault is re-checked on
 * chain first: its asset must still be USDC, and a V2 vault must have no
 * access gates, so a changed vault is refused rather than trusted.
 */
async function buildMorpho(input: Extract<EarnInput, { protocol: "morpho" }>, wallet: string, client: PublicClient = baseClient()): Promise<BuiltAction> {
  const vault = morphoVault(input.vault)!;
  const owner = getAddress(wallet);
  const read = <T>(functionName: "asset" | "receiveSharesGate" | "sendSharesGate" | "receiveAssetsGate" | "sendAssetsGate") =>
    client.readContract({ address: vault.address, abi: vaultAbi, functionName }) as Promise<T>;
  const gates = vault.version === 2 ? await Promise.all((["receiveSharesGate", "sendSharesGate", "receiveAssetsGate", "sendAssetsGate"] as const).map((name) => read<string>(name))) : [];
  if (getAddress(await read<string>("asset")) !== getAddress(vault.asset) || gates.some((gate) => BigInt(gate) !== 0n))
    throw new ActionInputError("contract_changed", `${vault.name} changed. It's paused in Aura until it's reviewed again.`);
  const shares = await client.readContract({ address: vault.address, abi: vaultAbi, functionName: "balanceOf", args: [owner] });
  const summary = { protocol: "morpho", vault: vault.id, vaultName: vault.name, direction: input.direction, symbol: vault.assetSymbol, decimals: vault.assetDecimals };
  const valuation = (raw: bigint) => ({ assetId: `8453:${vault.asset}`, amountRaw: raw.toString(), decimals: vault.assetDecimals });

  if (input.direction === "deposit") {
    if (input.amount === "all") throw new ActionInputError("invalid_amount", "Enter an amount to deposit.");
    const assets = rawAmount(input.amount, vault.assetDecimals);
    const balance = await client.readContract({ address: vault.asset, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
    if (balance < assets) throw new ActionInputError("insufficient_balance", "You don't have enough USDC.");
    return { kind: "earn", chainId: 8453, calls: morphoDepositCalls(vault, owner, assets),
      effects: [{ type: "morpho_deposit", vault: vault.address, assetsRaw: assets.toString() }],
      summary: { ...summary, amount: input.amount, amountRaw: assets.toString() }, countsTowardLimit: false, valuation: valuation(assets) };
  }
  if (shares === 0n) throw new ActionInputError("insufficient_balance", `You have nothing in ${vault.name}.`);
  if (input.amount === "all") {
    const assets = await client.readContract({ address: vault.address, abi: vaultAbi, functionName: "convertToAssets", args: [shares] });
    return { kind: "earn", chainId: 8453, calls: [morphoWithdrawCall(vault, owner, { shares })],
      effects: [{ type: "morpho_redeem", vault: vault.address, sharesRaw: shares.toString() }],
      summary: { ...summary, amount: "all", amountRaw: assets.toString(), sharesRaw: shares.toString() }, countsTowardLimit: false, valuation: valuation(assets) };
  }
  const assets = rawAmount(input.amount, vault.assetDecimals);
  const needed = await client.readContract({ address: vault.address, abi: vaultAbi, functionName: "previewWithdraw", args: [assets] });
  if (needed > shares) throw new ActionInputError("insufficient_balance", `You don't have that much in ${vault.name}.`);
  return { kind: "earn", chainId: 8453, calls: [morphoWithdrawCall(vault, owner, { assets })],
    effects: [{ type: "morpho_withdraw", vault: vault.address, assetsRaw: assets.toString() }],
    summary: { ...summary, amount: input.amount, amountRaw: assets.toString() }, countsTowardLimit: false, valuation: valuation(assets) };
}

export function buildEarn(input: EarnInput, wallet: string, client?: PublicClient): Promise<BuiltAction> {
  return input.protocol === "aave" ? buildAave(input, wallet, client) : buildMorpho(input, wallet, client);
}
