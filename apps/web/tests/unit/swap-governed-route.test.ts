import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";
import { LIFI_ERC20_SWAP_ABI, LIFI_FEE_FORWARDER_ABI } from "@/lib/swap/lifi-diamond-inspection";
import { validateGovernedSameChainPlan } from "@/lib/swap/governed-route";
import type { StoredSwapQuotePlan } from "@/lib/swap/plans";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const diamond = "0x2222222222222222222222222222222222222222" as const;
const feeForwarder = "0x3333333333333333333333333333333333333333" as const;
const feeRecipient = "0x4444444444444444444444444444444444444444" as const;
const router = "0x5555555555555555555555555555555555555555" as const;
const spender = router;
const source = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const destination = "0x4200000000000000000000000000000000000006" as const;
const txId = `0x${"ab".repeat(32)}` as const;
const exactInputSingle = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"]);
type Address = `0x${string}`;

const nowMs = Date.parse("2026-09-23T12:00:00.000Z");
const policy = {
  nowMs,
  routePolicyVersion: "reviewed-v1",
  diamond,
  allowedToolIds: new Set(["uniswap"]),
  routerSpenders: [{ router, spender, feeTiers: new Set([3000]) }],
  feeForwarder,
  feeRecipients: new Set([feeRecipient]),
  maxGasLimit: 2_000_000n,
  maxGasPriceWei: 100_000_000_000n
};

function nestedSwap(overrides: Partial<{ tokenIn: Address; tokenOut: Address; recipient: Address;
  fee: number; deadline: bigint; amountIn: bigint; amountOutMinimum: bigint;
  sqrtPriceLimitX96: bigint }> = {}) {
  return encodeFunctionData({ abi: exactInputSingle, functionName: "exactInputSingle",
    args: [{ tokenIn: overrides.tokenIn ?? source, tokenOut: overrides.tokenOut ?? destination,
      fee: overrides.fee ?? 3000, recipient: overrides.recipient ?? diamond,
      deadline: overrides.deadline ?? BigInt(Math.floor(nowMs / 1000) + 300),
      amountIn: overrides.amountIn ?? 997_500n,
      amountOutMinimum: overrides.amountOutMinimum ?? 900_000n,
      sqrtPriceLimitX96: overrides.sqrtPriceLimitX96 ?? 0n }] });
}

function feeCall(recipient: Address = feeRecipient, amount = 2_500n) {
  return encodeFunctionData({ abi: LIFI_FEE_FORWARDER_ABI, functionName: "forwardERC20Fees",
    args: [source, [{ recipient, amount }]] });
}

function plan(overrides: Partial<{ diamond: Address; receiver: Address; feeRecipient: Address;
  feeAmount: bigint; nested: `0x${string}`; swapRouter: Address; swapSpender: Address;
  swapAmount: bigint; feeDeposit: boolean; swapDeposit: boolean; outerMinimum: bigint;
  feeCall: `0x${string}`; extraSwap: boolean }> = {}): StoredSwapQuotePlan {
  const fee = { callTo: feeForwarder, approveTo: feeForwarder,
    sendingAssetId: source, receivingAssetId: source, fromAmount: 1_000_000n,
    callData: overrides.feeCall ?? feeCall(overrides.feeRecipient, overrides.feeAmount),
    requiresDeposit: overrides.feeDeposit ?? true };
  const swap = { callTo: overrides.swapRouter ?? router, approveTo: overrides.swapSpender ?? spender,
    sendingAssetId: source, receivingAssetId: destination,
    fromAmount: overrides.swapAmount ?? 997_500n,
    callData: overrides.nested ?? nestedSwap(), requiresDeposit: overrides.swapDeposit ?? false };
  const data = encodeFunctionData({ abi: LIFI_ERC20_SWAP_ABI,
    functionName: "swapTokensMultipleV3ERC20ToERC20",
    args: [txId, "aurel", "", overrides.receiver ?? wallet,
      overrides.outerMinimum ?? 900_000n, overrides.extraSwap ? [fee, swap, swap] : [fee, swap]] });
  return {
    plan_id: "plan-1", subject_reference: "subject-1", wallet_address: wallet,
    source_asset_id: `8453:${source.toLowerCase()}`, destination_asset_id: `8453:${destination.toLowerCase()}`,
    source_chain_id: 8453, destination_chain_id: 8453, from_amount_raw: "1000000",
    recipient: wallet, slippage_bps: 50, to_amount_min_raw: "900000",
    quote_id: "quote-1", step_id: "step-1", tool_id: "uniswap", approval_spender: diamond,
    route_steps_json: "[]", source_call_json: JSON.stringify({ chainId: 8453, from: wallet,
      to: overrides.diamond ?? diamond, value: "0", data }), economics_json: null,
    route_policy_version: "reviewed-v1", catalog_version: "catalog-v1",
    observed_at: new Date(nowMs - 1_000).toISOString(), expires_at: new Date(nowMs + 60_000).toISOString(),
    fingerprint: "fingerprint-1", status: "active", intent_id: null
  };
}

describe("governed LI.FI same-chain route", () => {
  it("accepts only a fully decoded fee plus Uniswap V3 exact-input call with bounded effects", () => {
    const result = validateGovernedSameChainPlan(plan(), policy);
    expect(result.sourceCall).toMatchObject({ chainId: 8453, from: wallet, to: diamond, value: "0" });
    expect(result.expectedEffect).toEqual({ wallet, sourceAssetId: `8453:${source.toLowerCase()}`,
      destinationAssetId: `8453:${destination.toLowerCase()}`, sourceAmountRaw: "1000000", grossInputRaw: "1000000",
      netInputRaw: "997500", feeRaw: "2500", minimumOutputRaw: "900000",
      recipient: wallet, router, spender, feeRecipients: [feeRecipient] });
  });

  it("rejects a fee sent to an unknown address, wrong fee total, or changed fee contract", () => {
    for (const bad of [plan({ feeRecipient: wallet }), plan({ feeAmount: 2_501n }),
      plan({ feeCall: "0x12345678" })]) {
      expect(() => validateGovernedSameChainPlan(bad, policy)).toThrow();
    }
  });

  it("rejects changed tokens, amount, minimum, recipient, fee tier, deadline, or price-limit behavior", () => {
    for (const nested of [nestedSwap({ tokenIn: destination }), nestedSwap({ tokenOut: source }),
      nestedSwap({ amountIn: 1n }), nestedSwap({ amountOutMinimum: 899_999n }),
      nestedSwap({ recipient: wallet }), nestedSwap({ fee: 100 }),
      nestedSwap({ deadline: BigInt(Math.floor(nowMs / 1000) - 1) }),
      nestedSwap({ deadline: BigInt(Math.floor(nowMs / 1000) + 86_400) }),
      nestedSwap({ sqrtPriceLimitX96: 1n })]) {
      expect(() => validateGovernedSameChainPlan(plan({ nested }), policy)).toThrow();
    }
  });

  it("rejects unknown router or spender, extra call, malformed ABI, and changed outer receiver", () => {
    for (const bad of [plan({ swapRouter: wallet }), plan({ swapSpender: wallet }),
      plan({ extraSwap: true }), plan({ nested: "0x12345678" }),
      plan({ nested: `${nestedSwap()}00` }), plan({ receiver: router }),
      plan({ diamond: wallet })]) {
      expect(() => validateGovernedSameChainPlan(bad, policy)).toThrow();
    }
  });

  it("rejects deposit changes, fee/net mismatch, stale policy, route, or quote", () => {
    for (const bad of [plan({ feeDeposit: false }), plan({ swapDeposit: true }),
      plan({ swapAmount: 997_499n }), { ...plan(), tool_id: "unknown" },
      { ...plan(), route_policy_version: "old" },
      { ...plan(), expires_at: new Date(nowMs).toISOString() },
      { ...plan(), expires_at: "invalid" },
      { ...plan(), observed_at: "invalid" }]) {
      expect(() => validateGovernedSameChainPlan(bad, policy)).toThrow();
    }
  });

  it("rejects provider gas estimates above explicit preparation caps", () => {
    const base = plan();
    for (const gas of [{ providerGasLimit: "2000001", providerGasPrice: "1" },
      { providerGasLimit: "1", providerGasPrice: "100000000001" }]) {
      expect(() => validateGovernedSameChainPlan({ ...base,
        source_call_json: JSON.stringify({ ...JSON.parse(base.source_call_json), ...gas }) }, policy)).toThrow();
    }
  });
});
