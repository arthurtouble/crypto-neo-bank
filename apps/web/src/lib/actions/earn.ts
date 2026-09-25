import { createPublicClient, erc20Abi, getAddress, http } from "viem";
import { mainnet } from "viem/chains";
import { z } from "zod";
import { AAVE_BASE_ASSETS } from "@/lib/defi/aave";
import { buildAaveBaseCall } from "@/lib/defi/aave-call-policy";
import { buildSkyCall, skyActionsAbi, skyConversionLimit, skyVaultAbi, SKY_PSM, SKY_SUSDS, SKY_USDC, SKY_USDC_ACTIONS, SKY_USDS } from "@/lib/defi/sky-call-policy";
import { ActionInputError, rawAmount } from "./transfer";
import type { BuiltAction, Call } from "./types";

export const earnInputSchema = z.strictObject({
  kind: z.literal("earn"),
  protocol: z.enum(["aave", "sky"]),
  direction: z.enum(["deposit", "withdraw"]),
  asset: z.enum(["USDC", "WETH"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/).max(40)
});
export type EarnInput = z.infer<typeof earnInputSchema>;

const toCall = (call: { to: string; value: string; data: string }): Call =>
  ({ to: call.to.toLowerCase() as `0x${string}`, value: call.value, data: call.data.toLowerCase() as `0x${string}` });

/** Aave V3 on Base. A deposit is an exact approval and supply in one operation. */
function buildAave(input: EarnInput, wallet: string): BuiltAction {
  const decimals = input.asset === "USDC" ? 6 : 18;
  const amountRaw = rawAmount(input.amount, decimals);
  const asset = AAVE_BASE_ASSETS[input.asset];
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

/** Sky sUSDS through Spark's USDC actions contract on Ethereum. */
async function buildSky(input: EarnInput, wallet: string, client = createPublicClient({ chain: mainnet,
  transport: http("https://ethereum-rpc.publicnode.com", { timeout: 12_000, retryCount: 0 }) })): Promise<BuiltAction> {
  if (input.asset !== "USDC") throw new ActionInputError("unsupported_asset", "Sky savings take USDC.");
  const amountRaw = rawAmount(input.amount, 6);
  const owner = getAddress(wallet);
  const [chainId, gem, dai, savingsToken, psm, usdcBalance, shares] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: SKY_USDC_ACTIONS, abi: skyActionsAbi, functionName: "gem" }),
    client.readContract({ address: SKY_USDC_ACTIONS, abi: skyActionsAbi, functionName: "dai" }),
    client.readContract({ address: SKY_USDC_ACTIONS, abi: skyActionsAbi, functionName: "savingsToken" }),
    client.readContract({ address: SKY_USDC_ACTIONS, abi: skyActionsAbi, functionName: "psm" }),
    client.readContract({ address: SKY_USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    client.readContract({ address: SKY_SUSDS, abi: skyVaultAbi, functionName: "balanceOf", args: [owner] })
  ]);
  if (chainId !== 1 || getAddress(gem) !== getAddress(SKY_USDC) || getAddress(dai) !== getAddress(SKY_USDS)
    || getAddress(savingsToken) !== getAddress(SKY_SUSDS) || getAddress(psm) !== getAddress(SKY_PSM))
    throw new ActionInputError("contract_changed", "Sky's contracts changed. Sky savings are paused until reviewed.");
  if (input.direction === "deposit" && usdcBalance < amountRaw) throw new ActionInputError("insufficient_balance", "You don't have enough USDC on Ethereum.");
  const action = input.direction === "deposit" ? "deposit" as const : "withdraw" as const;
  const approvalShares = action === "deposit" ? amountRaw
    : await client.readContract({ address: SKY_SUSDS, abi: skyVaultAbi, functionName: "previewWithdraw", args: [skyConversionLimit("withdraw", amountRaw)] });
  if (action === "withdraw" && (shares === 0n || approvalShares > shares)) throw new ActionInputError("insufficient_balance", "You don't have enough in Sky savings.");
  return {
    kind: "earn", chainId: 1,
    calls: [toCall(buildSkyCall({ action, wallet: owner, amountRaw, approvalShares })), toCall(buildSkyCall({ action, wallet: owner, amountRaw }))],
    effects: [{ type: action === "deposit" ? "sky_deposit" : "sky_withdraw", amountRaw: amountRaw.toString() }],
    summary: { protocol: "sky", direction: input.direction, symbol: "USDC", decimals: 6, amount: input.amount, amountRaw: amountRaw.toString() },
    countsTowardLimit: false,
    valuation: { assetId: `1:${SKY_USDC.toLowerCase()}`, amountRaw: amountRaw.toString(), decimals: 6 }
  };
}

export function buildEarn(input: EarnInput, wallet: string): Promise<BuiltAction> {
  return input.protocol === "aave" ? Promise.resolve(buildAave(input, wallet)) : buildSky(input, wallet);
}
