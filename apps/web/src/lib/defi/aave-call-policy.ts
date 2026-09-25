import { decodeFunctionData, encodeFunctionData, getAddress, isAddress, maxUint256 } from "viem";
import { z } from "zod";
import { AAVE_BASE_ASSETS, AAVE_BASE_V3_MARKET } from "./aave";

// Keep wallet calls bound to Aura's exact Base Aave methods and amounts.
const poolAbi = [
  { type: "function", name: "supply", inputs: [{ type: "address", name: "asset" }, { type: "uint256", name: "amount" }, { type: "address", name: "onBehalfOf" }, { type: "uint16", name: "referralCode" }] },
  { type: "function", name: "withdraw", inputs: [{ type: "address", name: "asset" }, { type: "uint256", name: "amount" }, { type: "address", name: "to" }] }
] as const;
const approvalAbi = [{ type: "function", name: "approve", inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }] }] as const;
const address = z.string().refine(isAddress);
const transactionSchema = z.strictObject({
  chainId: z.literal(8453),
  from: address,
  to: address,
  data: z.string().regex(/^0x(?:[a-fA-F0-9]{2})+$/),
  value: z.union([z.literal("0"), z.literal("0x0"), z.literal(0), z.literal(0n)])
});

export type AaveCallAction = "supply" | "withdraw" | "approve";

/** Build the narrow call Aura can review; no provider-supplied calldata enters signing. */
export function buildAaveBaseCall(input: { action: AaveCallAction; wallet: string; asset: string; amountRaw: bigint }) {
  if (!isAddress(input.wallet) || !isAddress(input.asset) || input.amountRaw <= 0n || input.amountRaw >= maxUint256)
    throw new Error("Invalid Aave call identity or amount.");
  const wallet = getAddress(input.wallet);
  const asset = getAddress(input.asset);
  if (!Object.values(AAVE_BASE_ASSETS).some((governed) => getAddress(governed) === asset))
    throw new Error("Aave asset is not governed.");
  const pool = getAddress(AAVE_BASE_V3_MARKET);
  const data = input.action === "approve"
    ? encodeFunctionData({ abi: approvalAbi, functionName: "approve", args: [pool, input.amountRaw] })
    : input.action === "supply"
      ? encodeFunctionData({ abi: poolAbi, functionName: "supply", args: [asset, input.amountRaw, wallet, 0] })
      : encodeFunctionData({ abi: poolAbi, functionName: "withdraw", args: [asset, input.amountRaw, wallet] });
  const transaction = { chainId: 8453 as const, from: wallet, to: input.action === "approve" ? asset : pool, data, value: "0" as const };
  validateAaveCall({ ...input, transaction });
  return transaction;
}

export function validateAaveCall(input: {
  action: AaveCallAction;
  wallet: string;
  asset: string;
  amountRaw: bigint;
  max?: boolean;
  transaction: unknown;
}) {
  if (!isAddress(input.wallet) || !isAddress(input.asset)) throw new Error("Invalid Aave call identity.");
  const wallet = getAddress(input.wallet);
  const asset = getAddress(input.asset);
  if (!Object.values(AAVE_BASE_ASSETS).some((governed) => getAddress(governed) === asset)) throw new Error("Aave asset is not governed.");
  if (input.amountRaw <= 0n || input.amountRaw >= maxUint256) throw new Error("Aave amount is not bounded.");
  if (input.max && input.action !== "withdraw") throw new Error("Max mode is unavailable for this action.");
  const tx = transactionSchema.parse(input.transaction);
  if (getAddress(tx.from) !== wallet) throw new Error("Aave signer differs from the linked wallet.");
  const isApproval = input.action === "approve";
  if (getAddress(tx.to) !== (isApproval ? asset : getAddress(AAVE_BASE_V3_MARKET))) throw new Error("Aave call target is not governed.");
  const words = { supply: 4, withdraw: 3, approve: 2 }[input.action];
  if (tx.data.length !== 2 + 8 + 64 * words) throw new Error("Aave call has unexpected calldata length.");
  const decoded = decodeFunctionData({ abi: isApproval ? approvalAbi : poolAbi, data: tx.data as `0x${string}` });
  if (decoded.functionName !== input.action) throw new Error("Aave call selector differs from the reviewed action.");
  const args = decoded.args;
  if (!args) throw new Error("Aave call has no arguments.");
  if (isApproval) {
    if (getAddress(args[0] as string) !== getAddress(AAVE_BASE_V3_MARKET) || args[1] !== input.amountRaw) throw new Error("Aave approval is not exact and bounded.");
  } else {
    const expectedAmount = input.max ? maxUint256 : input.amountRaw;
    if (getAddress(args[0] as string) !== asset || args[1] !== expectedAmount) throw new Error("Aave reserve or amount differs from review.");
    switch (input.action) {
      case "supply":
        if (getAddress(args[2] as string) !== wallet || args[3] !== 0) throw new Error("Aave supply beneficiary or referral differs from review.");
        break;
      case "withdraw":
        if (getAddress(args[2] as string) !== wallet) throw new Error("Aave withdrawal recipient differs from review.");
        break;
    }
  }
  // A Pool max call is not capped by the input reference amount. Never expose
  // that number as an exact authorized amount to a downstream limit check.
  return { action: input.action, wallet: wallet.toLowerCase(), asset: asset.toLowerCase(),
    amountMode: input.max ? "max" as const : "exact" as const,
    amountRaw: input.max ? null : input.amountRaw.toString(), max: Boolean(input.max), call: tx };
}
