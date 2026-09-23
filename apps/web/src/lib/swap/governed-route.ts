import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi } from "viem";
import { inspectLifiDiamondSwap, inspectLifiFeeForwarderCall } from "./lifi-diamond-inspection";
import { parseAssetId } from "./assets";
import type { StoredSwapQuotePlan } from "./plans";

// Uniswap V3 ISwapRouter, *not* SwapRouter02: the latter has a different tuple.
// https://github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/ISwapRouter.sol
const EXACT_INPUT_SINGLE_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"
]);

type Address = `0x${string}`;
export type GovernedSameChainPolicy = {
  nowMs: number;
  routePolicyVersion: string;
  diamond: Address;
  allowedToolIds: ReadonlySet<string>;
  routerSpenders: readonly { router: Address; spender: Address; feeTiers: ReadonlySet<number> }[];
  feeForwarder: Address;
  feeRecipients: ReadonlySet<string>;
  maxGasLimit: bigint;
  maxGasPriceWei: bigint;
};

export type GovernedSameChainRoute = {
  sourceCall: { chainId: number; from: string; to: string; value: string; data: string;
    providerGasLimit?: string; providerGasPrice?: string };
  expectedEffect: {
    wallet: string; sourceAssetId: string; destinationAssetId: string;
    sourceAmountRaw: string; grossInputRaw: string; netInputRaw: string; feeRaw: string;
    minimumOutputRaw: string; recipient: string; router: string; spender: string;
    feeRecipients: string[];
  };
};

const same = (a: string, b: string) => getAddress(a) === getAddress(b);
const positive = (value: string) => /^[1-9]\d*$/.test(value) && BigInt(value) <= (1n << 256n) - 1n;
const keysOnly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

/** No caller-supplied calldata is ever authorized by this function. Input must be a server-held plan. */
export function validateGovernedSameChainPlan(
  plan: StoredSwapQuotePlan, policy: GovernedSameChainPolicy
): GovernedSameChainRoute {
  const expiresMs = Date.parse(plan.expires_at);
  const observedMs = Date.parse(plan.observed_at);
  if (!Number.isSafeInteger(policy.nowMs) || policy.nowMs < 0
    || plan.status !== "active" || plan.route_policy_version !== policy.routePolicyVersion
    || !policy.allowedToolIds.has(plan.tool_id)
    || plan.source_chain_id !== 8453 || plan.destination_chain_id !== 8453
    || !Number.isFinite(expiresMs) || expiresMs <= policy.nowMs
    || !Number.isFinite(observedMs) || observedMs > policy.nowMs
    || !positive(plan.from_amount_raw) || !positive(plan.to_amount_min_raw))
    throw new Error("Swap plan is not current or reviewed.");
  const source = parseAssetId(plan.source_asset_id);
  const destination = parseAssetId(plan.destination_asset_id);
  if (!source?.address || !destination?.address || source.chainId !== 8453 || destination.chainId !== 8453
    || same(source.address, destination.address) || !same(plan.recipient, plan.wallet_address))
    throw new Error("Swap assets or recipient are not reviewed.");

  const rawCall: unknown = JSON.parse(plan.source_call_json);
  if (!rawCall || typeof rawCall !== "object" || Array.isArray(rawCall)) throw new Error("Swap call is invalid.");
  const call = rawCall as Record<string, unknown>;
  if (!keysOnly(call, ["chainId", "from", "to", "value", "data", "providerGasLimit", "providerGasPrice"])
    || call.chainId !== 8453 || typeof call.from !== "string" || !same(call.from, plan.wallet_address)
    || typeof call.to !== "string" || !same(call.to, policy.diamond)
    || call.value !== "0" || typeof call.data !== "string"
    || (call.providerGasLimit === undefined) !== (call.providerGasPrice === undefined)
    || call.providerGasLimit !== undefined && (typeof call.providerGasLimit !== "string" || !positive(call.providerGasLimit)
      || BigInt(call.providerGasLimit) > policy.maxGasLimit
      || typeof call.providerGasPrice !== "string" || !positive(call.providerGasPrice)
      || BigInt(call.providerGasPrice) > policy.maxGasPriceWei))
    throw new Error("Swap source call differs from review.");
  if (!plan.approval_spender || !same(plan.approval_spender, policy.diamond))
    throw new Error("Swap source approval is not reviewed.");

  const outer = inspectLifiDiamondSwap({ data: call.data, receiver: plan.recipient,
    minimumOutputRaw: plan.to_amount_min_raw });
  // The quote adapter emits an optional fee step followed by one swap. Other
  // LI.FI route shapes, multi-hop paths and contract aggregators remain denied.
  if (outer.integrator !== "aurel" || outer.referrer !== "" || outer.swaps.length !== 2)
    throw new Error("LI.FI route shape is not reviewed.");
  const [fee, swap] = outer.swaps;
  const gross = BigInt(plan.from_amount_raw);
  const net = BigInt(swap.fromAmountRaw);
  const feeAmount = gross - net;
  if (net <= 0n || feeAmount <= 0n || fee.fromAmountRaw !== plan.from_amount_raw
    || !same(fee.callTo, policy.feeForwarder) || !same(fee.approveTo, policy.feeForwarder)
    || !same(fee.sendingAssetId, source.address) || !same(fee.receivingAssetId, source.address)
    || !fee.requiresDeposit || swap.requiresDeposit
    || !same(swap.sendingAssetId, source.address) || !same(swap.receivingAssetId, destination.address))
    throw new Error("LI.FI fee or swap step differs from review.");
  const distribution = inspectLifiFeeForwarderCall({ data: fee.callData,
    token: source.address, expectedFeeRaw: feeAmount.toString() });
  if (distribution.distributions.some(({ recipient }) =>
    !policy.feeRecipients.has(recipient))) throw new Error("LI.FI fee recipient is not reviewed.");

  const routerPolicy = policy.routerSpenders.find(({ router, spender }) =>
    same(router, swap.callTo) && same(spender, swap.approveTo));
  if (!routerPolicy) throw new Error("Swap router or spender is not reviewed.");
  const decoded = decodeFunctionData({ abi: EXACT_INPUT_SINGLE_ABI, data: swap.callData as `0x${string}` });
  if (decoded.functionName !== "exactInputSingle" || !decoded.args)
    throw new Error("Swap selector is not reviewed.");
  const canonical = encodeFunctionData({ abi: EXACT_INPUT_SINGLE_ABI,
    functionName: "exactInputSingle", args: decoded.args });
  if (canonical.toLowerCase() !== swap.callData) throw new Error("Swap calldata is not canonical.");
  const [params] = decoded.args;
  const nowSeconds = BigInt(Math.floor(policy.nowMs / 1000));
  if (!same(params.tokenIn, source.address) || !same(params.tokenOut, destination.address)
    || !same(params.recipient, policy.diamond) || params.amountIn !== net
    || params.amountOutMinimum !== BigInt(plan.to_amount_min_raw)
    || !routerPolicy.feeTiers.has(params.fee)
    || params.deadline < nowSeconds || params.deadline > nowSeconds + 1_200n
    || params.sqrtPriceLimitX96 !== 0n)
    throw new Error("Swap execution parameters differ from review.");

  return {
    sourceCall: call as GovernedSameChainRoute["sourceCall"],
    expectedEffect: {
      wallet: plan.wallet_address.toLowerCase(), sourceAssetId: plan.source_asset_id,
      destinationAssetId: plan.destination_asset_id, sourceAmountRaw: plan.from_amount_raw,
      grossInputRaw: plan.from_amount_raw, netInputRaw: net.toString(), feeRaw: feeAmount.toString(),
      minimumOutputRaw: plan.to_amount_min_raw, recipient: plan.recipient.toLowerCase(),
      router: swap.callTo, spender: swap.approveTo,
      feeRecipients: distribution.distributions.map(({ recipient }) => recipient)
    }
  };
}
