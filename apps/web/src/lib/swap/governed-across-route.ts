import { getAddress } from "viem";
import { parseAssetId } from "./assets";
import { inspectLifiAcrossV4Call, inspectLifiFeeForwarderCall } from "./lifi-diamond-inspection";
import type { StoredSwapQuotePlan } from "./plans";

type Address = `0x${string}`;
type SourceCall = { chainId: number; from: string; to: string; value: string; data: string;
  providerGasLimit?: string; providerGasPrice?: string };

export type GovernedAcrossPolicy = {
  nowMs: number;
  routePolicyVersion: string;
  diamond: Address;
  feeForwarder: Address;
  feeRecipients: ReadonlySet<string>;
  maxGasLimit: bigint;
  maxGasPriceWei: bigint;
};

export type GovernedAcrossRoute = {
  sourceCall: SourceCall;
  expectedSourceEffect: { wallet: string; sourceAssetId: string; grossInputRaw: string;
    netInputRaw: string; feeRaw: string; bridgeAmountRaw: string; bridgeOutputRaw: string;
    quoteTimestamp: number; fillDeadline: number; feeRecipients: string[]; spender: string };
  expectedDestinationEffect: { wallet: string; recipient: string; destinationAssetId: string;
    outputAmountRaw: string; minimumOutputRaw: string };
};

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ARBITRUM_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const ONE = 1_000_000_000_000_000_000n;
const UINT256_MAX = (1n << 256n) - 1n;
const same = (a: string, b: string) => getAddress(a) === getAddress(b);
const positive = (value: string) => /^[1-9]\d*$/.test(value) && BigInt(value) <= UINT256_MAX;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keysOnly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

/** Inspect a retained quote. This does not execute or sign its source call. */
export function validateGovernedAcrossPlan(
  plan: StoredSwapQuotePlan, policy: GovernedAcrossPolicy
): GovernedAcrossRoute {
  const expiresMs = Date.parse(plan.expires_at);
  const observedMs = Date.parse(plan.observed_at);
  if (!Number.isSafeInteger(policy.nowMs) || policy.nowMs < 0
    || plan.status !== "active" || plan.route_policy_version !== policy.routePolicyVersion
    || plan.tool_id !== "across" || plan.source_chain_id !== 8453 || plan.destination_chain_id !== 42161
    || !Number.isFinite(expiresMs) || expiresMs <= policy.nowMs
    || !Number.isFinite(observedMs) || observedMs > policy.nowMs
    || !positive(plan.from_amount_raw) || !positive(plan.to_amount_min_raw))
    throw new Error("Across plan is not current or reviewed.");

  const source = parseAssetId(plan.source_asset_id);
  const destination = parseAssetId(plan.destination_asset_id);
  if (source?.chainId !== 8453 || source.address !== BASE_USDC
    || destination?.chainId !== 42161 || destination.address !== ARBITRUM_USDC
    || !same(plan.wallet_address, plan.recipient))
    throw new Error("Across assets or recipient are not reviewed.");

  const rawCall: unknown = JSON.parse(plan.source_call_json);
  if (!object(rawCall) || !keysOnly(rawCall,
    ["chainId", "from", "to", "value", "data", "providerGasLimit", "providerGasPrice"])
    || rawCall.chainId !== 8453 || typeof rawCall.from !== "string"
    || !same(rawCall.from, plan.wallet_address) || typeof rawCall.to !== "string"
    || !same(rawCall.to, policy.diamond) || rawCall.value !== "0"
    || typeof rawCall.data !== "string"
    || (rawCall.providerGasLimit === undefined) !== (rawCall.providerGasPrice === undefined)
    || rawCall.providerGasLimit !== undefined && (typeof rawCall.providerGasLimit !== "string"
      || !positive(rawCall.providerGasLimit) || BigInt(rawCall.providerGasLimit) > policy.maxGasLimit
      || typeof rawCall.providerGasPrice !== "string" || !positive(rawCall.providerGasPrice)
      || BigInt(rawCall.providerGasPrice) > policy.maxGasPriceWei))
    throw new Error("Across source call differs from review.");
  if (!plan.approval_spender || !same(plan.approval_spender, policy.diamond))
    throw new Error("Across source approval is not reviewed.");

  const decoded = inspectLifiAcrossV4Call({ data: rawCall.data, recipient: plan.wallet_address,
    sourceToken: BASE_USDC, destinationToken: ARBITRUM_USDC,
    destinationChainId: 42161, sourceAmountRaw: plan.from_amount_raw });
  const [fee] = decoded.swaps;
  const gross = BigInt(plan.from_amount_raw);
  const net = BigInt(decoded.minimumBridgeAmountRaw);
  const output = BigInt(decoded.outputAmountRaw);
  const minimum = BigInt(plan.to_amount_min_raw);
  const multiplier = BigInt(decoded.outputAmountMultiplierRaw);
  const nowSeconds = Math.floor(policy.nowMs / 1_000);
  if (decoded.swaps.length !== 1 || decoded.referrer !== ZERO_ADDRESS
    || decoded.refundAddress !== plan.wallet_address.toLowerCase()
    || decoded.exclusiveRelayer !== ZERO_BYTES32 || decoded.exclusivityParameter !== 0
    || decoded.quoteTimestamp < nowSeconds - 300 || decoded.quoteTimestamp > nowSeconds + 60
    || decoded.fillDeadline <= nowSeconds + 600 || decoded.fillDeadline > nowSeconds + 14_400
    || net <= 0n || net >= gross || multiplier > ONE
    || net * multiplier / ONE !== output || minimum <= 0n || minimum > output
    || fee.fromAmountRaw !== plan.from_amount_raw || !fee.requiresDeposit
    || !same(fee.callTo, policy.feeForwarder) || !same(fee.approveTo, policy.feeForwarder)
    || fee.sendingAssetId !== BASE_USDC || fee.receivingAssetId !== BASE_USDC)
    throw new Error("Across bridge or fee shape differs from review.");

  const distribution = inspectLifiFeeForwarderCall({ data: fee.callData, token: BASE_USDC,
    expectedFeeRaw: (gross - net).toString() });
  if (distribution.distributions.some(({ recipient }) => !policy.feeRecipients.has(recipient)))
    throw new Error("Across fee recipient is not reviewed.");

  const steps: unknown = JSON.parse(plan.route_steps_json);
  const economics: unknown = JSON.parse(plan.economics_json ?? "null");
  if (!Array.isArray(steps) || steps.length !== 2 || !object(steps[0]) || !object(steps[1])
    || steps[0].type !== "protocol" || steps[0].tool !== "feecollection"
    || steps[0].fromAssetId !== plan.source_asset_id || steps[0].toAssetId !== plan.source_asset_id
    || steps[0].fromAmountRaw !== plan.from_amount_raw || steps[0].toAmountRaw !== net.toString()
    || steps[1].type !== "cross" || steps[1].tool !== "across"
    || steps[1].fromAssetId !== plan.source_asset_id || steps[1].toAssetId !== plan.destination_asset_id
    || steps[1].fromAmountRaw !== net.toString() || steps[1].toAmountRaw !== output.toString()
    || steps[1].toAmountMinRaw !== plan.to_amount_min_raw
    || !object(economics) || economics.toAmountRaw !== output.toString()
    || plan.step_id !== plan.quote_id)
    throw new Error("Across plan economics differ from review.");

  return { sourceCall: rawCall as SourceCall,
    expectedSourceEffect: { wallet: plan.wallet_address.toLowerCase(), sourceAssetId: plan.source_asset_id,
      grossInputRaw: plan.from_amount_raw, netInputRaw: net.toString(), feeRaw: (gross - net).toString(),
      bridgeAmountRaw: net.toString(), bridgeOutputRaw: output.toString(),
      quoteTimestamp: decoded.quoteTimestamp, fillDeadline: decoded.fillDeadline,
      feeRecipients: distribution.distributions.map(({ recipient }) => recipient),
      spender: getAddress(policy.diamond).toLowerCase() },
    expectedDestinationEffect: { wallet: plan.wallet_address.toLowerCase(), recipient: plan.recipient.toLowerCase(),
      destinationAssetId: plan.destination_asset_id, outputAmountRaw: output.toString(),
      minimumOutputRaw: plan.to_amount_min_raw } };
}
