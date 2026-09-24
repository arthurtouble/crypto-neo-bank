import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { LIFI_ACROSS_V4_ABI, LIFI_FEE_FORWARDER_ABI } from "@/lib/swap/lifi-diamond-inspection";
import { validateGovernedAcrossPlan } from "@/lib/swap/governed-across-route";
import type { StoredSwapQuotePlan } from "@/lib/swap/plans";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const diamond = "0x2222222222222222222222222222222222222222" as const;
const feeForwarder = "0x3333333333333333333333333333333333333333" as const;
const feeRecipient = "0x4444444444444444444444444444444444444444" as const;
const source = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const destination = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
const ethereumUsdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const zeroAddress = "0x0000000000000000000000000000000000000000" as const;
const zeroBytes32 = `0x${"00".repeat(32)}` as `0x${string}`;
const nowMs = Date.parse("2026-09-23T12:00:00.000Z");
const seconds = Math.floor(nowMs / 1_000);
const bytes32 = (address: `0x${string}`) => `0x${"0".repeat(24)}${address.slice(2)}` as `0x${string}`;
const policy = { nowMs, routePolicyVersion: "reviewed-v1", diamond, feeForwarder,
  feeRecipients: new Set([feeRecipient]), maxGasLimit: 2_000_000n, maxGasPriceWei: 100_000_000_000n };

type Changes = {
  receiver: `0x${string}`; refund: `0x${string}`; referrer: `0x${string}`;
  sourceToken: `0x${string}`; destinationToken: `0x${string}`;
  minBridge: bigint; output: bigint; multiplier: bigint; quoteTimestamp: number; fillDeadline: number;
  exclusiveRelayer: `0x${string}`; exclusivityParameter: number; message: `0x${string}`;
  hasDestinationCall: boolean; feeTarget: `0x${string}`; feeSpender: `0x${string}`;
  feeRecipient: `0x${string}`; feeAmount: bigint; feeFromAmount: bigint;
  feeToken: `0x${string}`; feeDeposit: boolean; extraCall: boolean; feeCall: `0x${string}`;
};

function plan(changes: Partial<Changes> = {}, destinationChainId: 1 | 42161 = 42161): StoredSwapQuotePlan {
  const destinationAddress = destinationChainId === 1 ? ethereumUsdc : destination;
  const feeCall = changes.feeCall ?? encodeFunctionData({ abi: LIFI_FEE_FORWARDER_ABI,
    functionName: "forwardERC20Fees", args: [changes.feeToken ?? source,
      [{ recipient: changes.feeRecipient ?? feeRecipient, amount: changes.feeAmount ?? 2_500n }]] });
  const fee = { callTo: changes.feeTarget ?? feeForwarder, approveTo: changes.feeSpender ?? feeForwarder,
    sendingAssetId: source, receivingAssetId: source, fromAmount: changes.feeFromAmount ?? 1_000_000n,
    callData: feeCall, requiresDeposit: changes.feeDeposit ?? true };
  const data = encodeFunctionData({ abi: LIFI_ACROSS_V4_ABI,
    functionName: "swapAndStartBridgeTokensViaAcrossV4", args: [
      { transactionId: `0x${"ab".repeat(32)}`, bridge: "across", integrator: "aurel",
        referrer: changes.referrer ?? zeroAddress, sendingAssetId: changes.sourceToken ?? source,
        receiver: changes.receiver ?? wallet, minAmount: changes.minBridge ?? 997_500n,
        destinationChainId: BigInt(destinationChainId), hasSourceSwaps: true, hasDestinationCall: changes.hasDestinationCall ?? false },
      changes.extraCall ? [fee, fee] : [fee],
      { receiverAddress: bytes32(changes.receiver ?? wallet), refundAddress: bytes32(changes.refund ?? wallet),
        sendingAssetId: bytes32(changes.sourceToken ?? source),
        receivingAssetId: bytes32(changes.destinationToken ?? destinationAddress),
        outputAmount: changes.output ?? 987_525n, outputAmountMultiplier: changes.multiplier ?? 990_000_000_000_000_000n,
        exclusiveRelayer: changes.exclusiveRelayer ?? zeroBytes32,
        quoteTimestamp: changes.quoteTimestamp ?? seconds - 10, fillDeadline: changes.fillDeadline ?? seconds + 3_600,
        exclusivityParameter: changes.exclusivityParameter ?? 0, message: changes.message ?? "0x" }
    ] });
  return { plan_id: "plan-1", subject_reference: "subject-1", wallet_address: wallet,
    source_asset_id: `8453:${source.toLowerCase()}`, destination_asset_id: `${destinationChainId}:${destinationAddress.toLowerCase()}`,
    source_chain_id: 8453, destination_chain_id: destinationChainId, from_amount_raw: "1000000", recipient: wallet,
    slippage_bps: 50, to_amount_min_raw: "980000", quote_id: "quote-1", step_id: "quote-1",
    tool_id: "across", approval_spender: diamond,
    route_steps_json: JSON.stringify([
      { type: "protocol", tool: "feecollection", fromAssetId: `8453:${source.toLowerCase()}`,
        toAssetId: `8453:${source.toLowerCase()}`, fromAmountRaw: "1000000", toAmountRaw: "997500" },
      { type: "cross", tool: "across", fromAssetId: `8453:${source.toLowerCase()}`,
        toAssetId: `${destinationChainId}:${destinationAddress.toLowerCase()}`, fromAmountRaw: "997500", toAmountRaw: "987525",
        toAmountMinRaw: "980000" }]),
    source_call_json: JSON.stringify({ chainId: 8453, from: wallet, to: diamond, value: "0", data }),
    economics_json: JSON.stringify({ toAmountRaw: "987525" }), route_policy_version: "reviewed-v1",
    catalog_version: "catalog-v1", observed_at: new Date(nowMs - 1_000).toISOString(),
    expires_at: new Date(nowMs + 60_000).toISOString(), fingerprint: "fingerprint-1", status: "active", intent_id: null };
}

const changed = (base: StoredSwapQuotePlan, field: keyof StoredSwapQuotePlan, value: unknown) =>
  ({ ...base, [field]: value }) as StoredSwapQuotePlan;

describe("governed LI.FI Across V4 route", () => {
  it("reviews Base USDC to Ethereum USDC for the same wallet", () => {
    const route = validateGovernedAcrossPlan(plan({}, 1), policy);
    expect(route.expectedDestinationEffect).toMatchObject({ recipient: wallet,
      destinationAssetId: `1:${ethereumUsdc.toLowerCase()}`, minimumOutputRaw: "980000" });
    expect(() => validateGovernedAcrossPlan(plan({ destinationToken: destination }, 1), policy)).toThrow();
  });
  it("returns the exact reviewed source call and bounded effects", () => {
    const result = validateGovernedAcrossPlan(plan(), policy);
    expect(result.sourceCall).toMatchObject({ chainId: 8453, from: wallet, to: diamond, value: "0" });
    expect(result.expectedSourceEffect).toEqual({ wallet, sourceAssetId: `8453:${source.toLowerCase()}`,
      grossInputRaw: "1000000", netInputRaw: "997500", feeRaw: "2500", bridgeAmountRaw: "997500",
      bridgeOutputRaw: "987525", quoteTimestamp: seconds - 10, fillDeadline: seconds + 3_600,
      feeRecipients: [feeRecipient], spender: diamond });
    expect(result.expectedDestinationEffect).toEqual({ wallet, recipient: wallet,
      destinationAssetId: `42161:${destination.toLowerCase()}`, outputAmountRaw: "987525",
      minimumOutputRaw: "980000" });
  });

  it("accepts LI.FI's feeCollection tool casing in a retained quote", () => {
    const retained = plan();
    const steps = JSON.parse(retained.route_steps_json);
    steps[0].tool = "feeCollection";
    retained.route_steps_json = JSON.stringify(steps);
    expect(validateGovernedAcrossPlan(retained, policy).expectedSourceEffect.feeRaw).toBe("2500");
  });

  it("denies changed fee recipients, fee calldata, fee target, or extra executable calls", () => {
    for (const bad of [plan({ feeRecipient: wallet }), plan({ feeAmount: 2_501n }),
      plan({ feeCall: "0x12345678" }), plan({ feeTarget: wallet }), plan({ feeSpender: wallet }),
      plan({ feeDeposit: false }), plan({ extraCall: true })])
      expect(() => validateGovernedAcrossPlan(bad, policy)).toThrow();
  });

  it("denies changed bridge economics, destination behavior, recipient, and deadlines", () => {
    for (const bad of [plan({ minBridge: 997_499n }), plan({ output: 989_999n }),
      plan({ multiplier: 989_999_999_999_999_999n }), plan({ multiplier: 1_000_000_000_000_000_001n }),
      plan({ refund: feeRecipient }), plan({ receiver: feeRecipient }), plan({ referrer: feeRecipient }),
      plan({ destinationToken: source }), plan({ hasDestinationCall: true }),
      plan({ exclusiveRelayer: bytes32(wallet) }), plan({ exclusivityParameter: 1 }),
      plan({ message: "0x1234" }), plan({ quoteTimestamp: seconds - 301 }),
      plan({ quoteTimestamp: seconds + 61 }), plan({ fillDeadline: seconds + 600 }),
      plan({ fillDeadline: seconds + 14_401 })])
      expect(() => validateGovernedAcrossPlan(bad, policy)).toThrow();
  });

  it("denies changed retained amounts, destination asset, status, policy, approval, and source call", () => {
    const base = plan();
    const steps = JSON.parse(base.route_steps_json);
    const economics = JSON.parse(base.economics_json!);
    const call = JSON.parse(base.source_call_json);
    for (const bad of [
      changed(base, "from_amount_raw", "1000001"), changed(base, "to_amount_min_raw", "990001"),
      changed(base, "route_steps_json", JSON.stringify([{ ...steps[0], toAmountRaw: "997499" }, steps[1]])),
      changed(base, "route_steps_json", JSON.stringify([steps[0], { ...steps[1], toAmountRaw: "989999" }])),
      changed(base, "economics_json", JSON.stringify({ ...economics, toAmountRaw: "989999" })),
      changed(base, "destination_asset_id", `8453:${destination.toLowerCase()}`),
      changed(base, "status", "superseded"), changed(base, "route_policy_version", "old"),
      changed(base, "approval_spender", wallet), changed(base, "recipient", feeRecipient),
      changed(base, "expires_at", new Date(nowMs).toISOString()),
      changed(base, "source_call_json", JSON.stringify({ ...call, to: wallet })),
      changed(base, "source_call_json", JSON.stringify({ ...call, value: "1" })),
      changed(base, "source_call_json", JSON.stringify({ ...call, extra: true }))
    ]) expect(() => validateGovernedAcrossPlan(bad, policy)).toThrow();
  });
});
