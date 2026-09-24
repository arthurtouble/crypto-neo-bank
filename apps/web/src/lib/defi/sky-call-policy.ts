import { decodeFunctionData, encodeFunctionData, getAddress, isAddress, maxUint256, parseAbi } from "viem";

// Spark's Ethereum PSMVariant1Actions USDC ↔ sUSDS deployment.
// https://github.com/sparkdotfi/spark-user-actions#deployments
export const SKY_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const SKY_USDS = "0xdC035D45d973E3EC169d2276DDab16f1e407384F";
export const SKY_SUSDS = "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD";
export const SKY_USDC_ACTIONS = "0xd0A61F2963622e992e6534bde4D52fd0a89F39E0";
export const SKY_PSM = "0xA188EEC8F81263234dA3622A406892F3D630f98c";
export const skyActionsAbi = parseAbi([
  "function psm() view returns (address)",
  "function dai() view returns (address)",
  "function gem() view returns (address)",
  "function savingsToken() view returns (address)",
  "function swapAndDeposit(address receiver, uint256 amountIn, uint256 minAmountOut) returns (uint256)",
  "function withdrawAndSwap(address receiver, uint256 amountOut, uint256 maxAmountIn) returns (uint256)"
]);
export const skyVaultAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)"
]);
const approvalAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
export type SkyAction = "deposit" | "withdraw";
const USDC_TO_USDS = 1_000_000_000_000n;

// Bound conversion to within 1% of USDC par. A larger fee fails closed.
export function skyConversionLimit(action: SkyAction, usdcRaw: bigint) {
  const parity = usdcRaw * USDC_TO_USDS;
  return action === "deposit" ? parity * 99n / 100n : (parity * 101n + 99n) / 100n;
}

export function buildSkyCall(input: { action: SkyAction; wallet: string; amountRaw: bigint; approvalShares?: bigint }) {
  if (!isAddress(input.wallet) || input.amountRaw <= 0n || input.amountRaw >= maxUint256 / USDC_TO_USDS)
    throw new Error("Invalid Sky call identity or amount.");
  const wallet = getAddress(input.wallet);
  const limit = skyConversionLimit(input.action, input.amountRaw);
  const isApproval = input.approvalShares !== undefined;
  if (isApproval && (input.approvalShares! <= 0n || input.approvalShares! >= maxUint256))
    throw new Error("Invalid Sky approval amount.");
  const data = isApproval
    ? encodeFunctionData({ abi: approvalAbi, functionName: "approve", args: [SKY_USDC_ACTIONS,
      input.action === "deposit" ? input.amountRaw : input.approvalShares!] })
    : input.action === "deposit"
      ? encodeFunctionData({ abi: skyActionsAbi, functionName: "swapAndDeposit", args: [wallet, input.amountRaw, limit] })
      : encodeFunctionData({ abi: skyActionsAbi, functionName: "withdrawAndSwap", args: [wallet, input.amountRaw, limit] });
  const transaction = { chainId: 1 as const, from: wallet,
    to: isApproval ? input.action === "deposit" ? SKY_USDC : SKY_SUSDS : SKY_USDC_ACTIONS,
    value: "0" as const, data };
  validateSkyCall({ ...input, transaction });
  return transaction;
}

export function validateSkyCall(input: { action: SkyAction; wallet: string; amountRaw: bigint;
  approvalShares?: bigint; transaction: unknown }) {
  if (!isAddress(input.wallet) || input.amountRaw <= 0n || input.amountRaw >= maxUint256 / USDC_TO_USDS)
    throw new Error("Invalid Sky call identity or amount.");
  if (!input.transaction || typeof input.transaction !== "object") throw new Error("Sky transaction is missing.");
  const call = input.transaction as Record<string, unknown>;
  const approval = input.approvalShares !== undefined;
  const target = approval ? input.action === "deposit" ? SKY_USDC : SKY_SUSDS : SKY_USDC_ACTIONS;
  if (call.chainId !== 1 || typeof call.from !== "string" || !isAddress(call.from)
    || typeof call.to !== "string" || !isAddress(call.to) || call.value !== "0"
    || typeof call.data !== "string" || !/^0x(?:[a-fA-F0-9]{2})+$/.test(call.data)
    || getAddress(call.from) !== getAddress(input.wallet) || getAddress(call.to) !== getAddress(target)
    || call.data.length !== 2 + 8 + 64 * (approval ? 2 : 3))
    throw new Error("Sky transaction differs from review.");
  const decoded = decodeFunctionData({ abi: approval ? approvalAbi : skyActionsAbi, data: call.data as `0x${string}` });
  if (approval) {
    if (decoded.functionName !== "approve" || getAddress(decoded.args[0] as string) !== getAddress(SKY_USDC_ACTIONS)
      || decoded.args[1] !== (input.action === "deposit" ? input.amountRaw : input.approvalShares))
      throw new Error("Sky approval differs from review.");
  } else if (decoded.functionName !== (input.action === "deposit" ? "swapAndDeposit" : "withdrawAndSwap")
    || getAddress(decoded.args[0] as string) !== getAddress(input.wallet)
    || decoded.args[1] !== input.amountRaw || decoded.args[2] !== skyConversionLimit(input.action, input.amountRaw))
    throw new Error("Sky action differs from review.");
  return call;
}
