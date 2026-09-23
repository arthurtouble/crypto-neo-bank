import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, parseAbi, type PublicClient } from "viem";
import { normalizePreparedCall, type NormalizedPreparedCall, type PreparedCallInput } from "@/lib/transactions/evidence";
import { parseAssetId } from "./assets";

const L1_FEE_ORACLE = "0x420000000000000000000000000000000000000F";
const L1_FEE_ABI = parseAbi(["function getL1FeeUpperBound(uint256) view returns (uint256)"]);

type SwapSourceBalance = {
  chainId: number; wallet: string; assetId: string; amountRaw: string; balanceRaw: string;
  blockNumber: bigint; blockHash: `0x${string}`; observedAtMs: number;
};

type Request = {
  call: NormalizedPreparedCall;
  plan: { sourceCall: PreparedCallInput; fromChainId: number; fromAssetId: string; fromAmountRaw: string };
  sourceBalance: SwapSourceBalance;
  nowMs: number;
  maxAgeMs: number;
};

/** Canonical source-chain simulation and estimated native reserve. This is evidence, not signing permission. */
export async function observeSwapExecutionBudget(client: PublicClient, request: Request) {
  const { call, plan, sourceBalance } = request;
  const normalized = await normalizePreparedCall(call);
  const planned = await normalizePreparedCall(plan.sourceCall);
  const asset = parseAssetId(plan.fromAssetId);
  if (!asset || asset.chainId !== plan.fromChainId || planned.chainId !== plan.fromChainId
    || normalized.fingerprint !== call.fingerprint || normalized.dataHash !== call.dataHash
    || normalized.fingerprint !== planned.fingerprint || normalized.dataHash !== planned.dataHash
    || normalized.data !== call.data || normalized.value !== call.value
    || !/^[1-9]\d*$/.test(plan.fromAmountRaw)
    || (asset.address === null ? normalized.value !== plan.fromAmountRaw : normalized.value !== "0"))
    throw new Error("Swap call does not match its server-held source plan.");

  if (sourceBalance.chainId !== plan.fromChainId || sourceBalance.assetId !== plan.fromAssetId
    || getAddress(sourceBalance.wallet) !== normalized.from || sourceBalance.amountRaw !== plan.fromAmountRaw
    || !/^\d+$/.test(sourceBalance.balanceRaw)
    || BigInt(sourceBalance.balanceRaw) < BigInt(plan.fromAmountRaw)
    || !/^0x[0-9a-f]{64}$/i.test(sourceBalance.blockHash)
    || sourceBalance.blockHash === `0x${"0".repeat(64)}`
    || sourceBalance.blockNumber < 0n)
    throw new Error("Source balance evidence does not match the Swap plan.");
  if (!Number.isSafeInteger(request.nowMs) || !Number.isSafeInteger(request.maxAgeMs)
    || request.maxAgeMs <= 0 || !Number.isSafeInteger(sourceBalance.observedAtMs)
    || sourceBalance.observedAtMs > request.nowMs
    || request.nowMs - sourceBalance.observedAtMs > request.maxAgeMs)
    throw new Error("Source balance evidence is stale.");
  if (await client.getChainId() !== plan.fromChainId) throw new Error("Source RPC chain mismatch.");

  const block = await client.getBlock({ blockNumber: sourceBalance.blockNumber });
  if (block.hash?.toLowerCase() !== sourceBalance.blockHash.toLowerCase()
    || Number(block.timestamp) * 1_000 !== sourceBalance.observedAtMs
    || block.baseFeePerGas === null) throw new Error("Canonical source block changed or lacks fee data.");
  const blockHash = sourceBalance.blockHash;
  const sourceBalanceNow = asset.address === null
    ? await client.getBalance({ address: normalized.from, blockHash, requireCanonical: true })
    : decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf",
      data: (await client.call({ to: getAddress(asset.address),
        data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [normalized.from] }),
        blockHash, requireCanonical: true })).data ?? "0x" });
  if (sourceBalanceNow !== BigInt(sourceBalance.balanceRaw)
    || sourceBalanceNow < BigInt(plan.fromAmountRaw)) throw new Error("Source asset balance changed or is insufficient.");

  await client.call({ account: normalized.from, to: normalized.to, value: BigInt(normalized.value),
    data: normalized.data, blockHash, requireCanonical: true });
  // viem estimates against a block number; re-check canonicality after every observation.
  const gasEstimate = await client.estimateGas({ account: normalized.from, to: normalized.to,
    value: BigInt(normalized.value), data: normalized.data, blockNumber: sourceBalance.blockNumber });
  const gasLimit = gasEstimate * 125n / 100n + 1_000n;
  if (gasEstimate <= 0n || gasLimit > block.gasLimit) throw new Error("Invalid Swap gas estimate.");
  const fees = await client.estimateFeesPerGas({ type: "eip1559", chain: null });
  if (fees.maxFeePerGas <= 0n || fees.maxPriorityFeePerGas < 0n
    || fees.maxPriorityFeePerGas > fees.maxFeePerGas || fees.maxFeePerGas < block.baseFeePerGas)
    throw new Error("Invalid Swap fee quote.");

  let l1FeeUpperBound = 0n;
  // Both OP Stack chains have an L1 data fee not covered by the L2 gas estimate.
  if (plan.fromChainId === 8453 || plan.fromChainId === 10) {
    const size = 256n + BigInt((normalized.data.length - 2) / 2);
    const result = await client.call({ to: L1_FEE_ORACLE,
      data: encodeFunctionData({ abi: L1_FEE_ABI, functionName: "getL1FeeUpperBound", args: [size] }),
      blockHash, requireCanonical: true });
    if (!result.data) throw new Error("L1 fee oracle unavailable.");
    l1FeeUpperBound = decodeFunctionResult({ abi: L1_FEE_ABI,
      functionName: "getL1FeeUpperBound", data: result.data });
  }
  const nativeBalance = asset.address === null ? sourceBalanceNow
    : await client.getBalance({ address: normalized.from, blockHash, requireCanonical: true });
  const canonical = await client.getBlock({ blockNumber: sourceBalance.blockNumber });
  if (canonical.hash?.toLowerCase() !== blockHash.toLowerCase()
    || canonical.timestamp !== block.timestamp) throw new Error("Canonical source block changed.");

  const requiredNative = BigInt(normalized.value) + gasLimit * fees.maxFeePerGas + l1FeeUpperBound;
  if (nativeBalance < requiredNative) throw new Error("Insufficient native balance for Swap value and fee reserve.");
  return { chainId: plan.fromChainId, blockNumber: sourceBalance.blockNumber, blockHash,
    observedAtMs: sourceBalance.observedAtMs, fingerprint: normalized.fingerprint,
    sourceBalanceRaw: sourceBalanceNow.toString(), nativeBalanceRaw: nativeBalance.toString(),
    gasEstimateRaw: gasEstimate.toString(), gasLimitRaw: gasLimit.toString(),
    maxFeePerGasRaw: fees.maxFeePerGas.toString(),
    maxPriorityFeePerGasRaw: fees.maxPriorityFeePerGas.toString(),
    l1FeeUpperBoundRaw: l1FeeUpperBound.toString(), requiredNativeRaw: requiredNative.toString(),
    simulationSucceeded: true as const, estimatedReserveSufficient: true as const,
    signingReady: false as const };
}
