import { decodeFunctionData, encodeFunctionData, decodeFunctionResult, erc20Abi, parseAbi, type PublicClient } from "viem";
import { normalizePreparedCall, type NormalizedPreparedCall } from "./evidence";

const ORACLE = "0x420000000000000000000000000000000000000F";
const ORACLE_ABI = parseAbi(["function getL1FeeUpperBound(uint256) view returns (uint256)"]);

type Simulation = {
  chainId: 8453;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  observedAtMs: number;
  fingerprint: `0x${string}`;
  simulationSucceeded: true;
  assetBalanceRaw: string;
  assetBalanceObserved: true;
};

type Request = {
  call: NormalizedPreparedCall;
  simulation: Simulation;
  amountRaw: string;
  nativeAsset: boolean;
  nowMs: number;
  maxAgeMs: number;
};

/** An observed fee reserve, not a signing authorization or future fee guarantee. */
export async function observeBaseDirectTransferFeeBudget(client: PublicClient, request: Request) {
  const { call, simulation } = request;
  const normalized = await normalizePreparedCall(call);
  if (normalized.chainId !== 8453 || normalized.fingerprint !== call.fingerprint
    || normalized.dataHash !== call.dataHash || normalized.data !== call.data || normalized.value !== call.value
    || simulation.chainId !== 8453 || simulation.fingerprint !== normalized.fingerprint
    || simulation.simulationSucceeded !== true || simulation.assetBalanceObserved !== true)
    throw new Error("Transfer and simulation identity do not match.");
  if (!/^[1-9]\d*$/.test(request.amountRaw) || !/^\d+$/.test(simulation.assetBalanceRaw))
    throw new Error("Invalid asset amount or observed balance.");
  const amount = BigInt(request.amountRaw);
  if (BigInt(simulation.assetBalanceRaw) < amount) throw new Error("Insufficient asset balance.");
  if (request.nativeAsset && (normalized.value !== request.amountRaw || normalized.data !== "0x"))
    throw new Error("Native transfer amount does not match the prepared call.");
  if (!request.nativeAsset) {
    if (normalized.value !== "0") throw new Error("Token transfer must not send ETH value.");
    const decoded = decodeFunctionData({ abi: erc20Abi, data: normalized.data });
    if (decoded.functionName !== "transfer" || decoded.args[1] !== amount)
      throw new Error("Token transfer calldata amount does not match.");
  }
  if (!Number.isSafeInteger(request.nowMs) || !Number.isSafeInteger(request.maxAgeMs)
    || request.maxAgeMs <= 0 || !Number.isSafeInteger(simulation.observedAtMs)
    || simulation.observedAtMs > request.nowMs || request.nowMs - simulation.observedAtMs > request.maxAgeMs)
    throw new Error("Simulation block is stale.");
  if (await client.getChainId() !== 8453) throw new Error("Base RPC chain mismatch.");
  const block = await client.getBlock({ blockNumber: simulation.blockNumber });
  if (!block.hash || block.hash.toLowerCase() !== simulation.blockHash.toLowerCase()
    || Number(block.timestamp) * 1_000 !== simulation.observedAtMs || block.baseFeePerGas === null)
    throw new Error("Canonical simulation block changed or lacks fee data.");

  const transfer = await client.call({ account: normalized.from, to: normalized.to,
    value: BigInt(normalized.value), data: normalized.data,
    blockHash: simulation.blockHash, requireCanonical: true });
  if (!request.nativeAsset) {
    if (transfer.data !== `0x${"0".repeat(63)}1`) throw new Error("Token transfer simulation did not return true.");
    const balanceResult = await client.call({ to: normalized.to,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [normalized.from] }),
      blockHash: simulation.blockHash, requireCanonical: true });
    const tokenBalance = decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf",
      data: balanceResult.data ?? "0x" });
    if (tokenBalance < amount) throw new Error("Insufficient token balance at the canonical block.");
  }

  // estimateGas is block-number scoped in viem, so canonicality is checked both before and after.
  const gasEstimate = await client.estimateGas({ account: normalized.from, to: normalized.to,
    value: BigInt(normalized.value), data: normalized.data, blockNumber: simulation.blockNumber });
  const gasLimit = gasEstimate * 125n / 100n + 1_000n;
  if (gasEstimate <= 0n || gasLimit > block.gasLimit) throw new Error("Invalid transfer gas estimate.");
  const fees = await client.estimateFeesPerGas({ type: "eip1559", chain: null });
  if (fees.maxFeePerGas <= 0n || fees.maxPriorityFeePerGas < 0n
    || fees.maxPriorityFeePerGas > fees.maxFeePerGas || fees.maxFeePerGas < block.baseFeePerGas)
    throw new Error("Invalid transfer fee quote.");
  // Conservative calldata allowance. The oracle reports an L1 upper bound for this size,
  // but the eventual signed transaction size and fee caps must still be checked later.
  const transactionSizeBytes = 256n + BigInt((normalized.data.length - 2) / 2);
  const l1Result = await client.call({ to: ORACLE,
    data: encodeFunctionData({ abi: ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [transactionSizeBytes] }),
    blockHash: simulation.blockHash, requireCanonical: true });
  if (!l1Result.data) throw new Error("Base L1 fee oracle unavailable.");
  const l1FeeUpperBound = decodeFunctionResult({ abi: ORACLE_ABI,
    functionName: "getL1FeeUpperBound", data: l1Result.data });
  const ethBalance = await client.getBalance({ address: normalized.from,
    blockHash: simulation.blockHash, requireCanonical: true });
  const canonical = await client.getBlock({ blockNumber: simulation.blockNumber });
  if (canonical.hash?.toLowerCase() !== simulation.blockHash.toLowerCase()
    || canonical.timestamp !== block.timestamp) throw new Error("Canonical simulation block changed.");
  const requiredEth = (request.nativeAsset ? amount : 0n) + gasLimit * fees.maxFeePerGas + l1FeeUpperBound;
  if (ethBalance < requiredEth) throw new Error("Insufficient ETH balance for transfer and estimated fees.");
  return {
    chainId: 8453 as const, blockNumber: simulation.blockNumber, blockHash: simulation.blockHash,
    fingerprint: normalized.fingerprint, gasEstimateRaw: gasEstimate.toString(), gasLimitRaw: gasLimit.toString(),
    maxFeePerGasRaw: fees.maxFeePerGas.toString(), maxPriorityFeePerGasRaw: fees.maxPriorityFeePerGas.toString(),
    l1FeeUpperBoundRaw: l1FeeUpperBound.toString(), estimatedTransactionSizeBytesRaw: transactionSizeBytes.toString(),
    requiredEthRaw: requiredEth.toString(), ethBalanceRaw: ethBalance.toString(),
    estimatedReserveSufficient: true as const, signingReady: false as const
  };
}
