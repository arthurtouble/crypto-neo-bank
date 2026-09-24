import { describe, expect, it, vi } from "vitest";
import { createLifiQuoteAdapter } from "@/lib/swap/lifi";
import { inspectLifiAcrossV4Call, inspectLifiDiamondSwap, inspectLifiFeeForwarderCall } from "@/lib/swap/lifi-diamond-inspection";
import { assertSwapPrepareIntegrity } from "@/lib/swap/prepare-integrity";
import type { CatalogAsset } from "@/lib/swap/assets";
import type { StoredSwapQuotePlan } from "@/lib/swap/plans";

const diamond = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
// Observational drift sentinels, not execution allowlists.
const observedFeeForwarder = "0xce40449b773a3e6e5e769adb4e567179d4828cbd";
const observedNordstern = "0xc87de04e2ec1f4282dff2933a2d58199f688fc3d";
const observedFeeRecipient = "0xc06ebbefd94032b85424d51906e2a335efae264b";
const wallet = "0x000000000000000000000000000000000000dEaD";
const from: CatalogAsset = { id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453,
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin",
  decimals: 6, logoUrl: null, verification: "verified", eligibility: "eligible" };
const to: CatalogAsset = { id: "8453:0x4200000000000000000000000000000000000006", chainId: 8453,
  address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether",
  decimals: 18, logoUrl: null, verification: "verified", eligibility: "eligible" };
const arbitrumUsdc: CatalogAsset = { id: "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831", chainId: 42161,
  address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", symbol: "USDC", name: "USD Coin",
  decimals: 6, logoUrl: null, verification: "verified", eligibility: "eligible" };

describe.skipIf(process.env.AUREL_LIVE_READONLY !== "1")("LI.FI Base composite quote", () => {
  it("retains a current fee-plus-swap quote privately without authorizing execution", async () => {
    const adapter = createLifiQuoteAdapter({ policy: {
      allowedTools: new Set(["nordstern", "feecollection"]), allowedExchanges: new Set(["nordstern"]),
      allowedBridges: new Set(), allowedTargets: new Set([diamond]), allowedApprovalTargets: new Set([diamond])
    } });
    const [result] = await adapter.quoteWithPlans({ fromAssetId: from.id, toAssetId: to.id,
      amount: "10", fromAddress: wallet, slippageBps: 50 }, { from, to });
    expect(result.quote).toMatchObject({ provider: "lifi:nordstern", routeKind: "same_chain" });
    expect(result.quote).not.toHaveProperty("sourceCall");
    expect(result.plan.routeSteps.map((step) => step.type)).toEqual(["protocol", "swap"]);
    expect(result.plan.sourceCall.to).toBe(diamond);
    const decoded = inspectLifiDiamondSwap({ data: result.plan.sourceCall.data,
      receiver: wallet, minimumOutputRaw: result.plan.toAmountMinRaw });
    expect(decoded.swaps).toHaveLength(2);
    expect(decoded.swaps.map((swap) => swap.callData.slice(0, 10))).toEqual(["0x332d746b", "0x3f0bde25"]);
    expect(decoded.swaps.map((swap) => swap.requiresDeposit)).toEqual([true, false]);
    expect(decoded.swaps[0]).toMatchObject({ sendingAssetId: from.address!.toLowerCase(),
      receivingAssetId: from.address!.toLowerCase(), fromAmountRaw: result.plan.fromAmountRaw });
    expect(decoded.swaps[1]).toMatchObject({ sendingAssetId: from.address!.toLowerCase(),
      receivingAssetId: to.address!.toLowerCase(), fromAmountRaw: result.plan.routeSteps[0].toAmountRaw });
    expect(decoded.swaps.every((swap) => swap.callTo === swap.approveTo)).toBe(true);
    expect(decoded.swaps.map((swap) => swap.callTo)).toEqual([observedFeeForwarder, observedNordstern]);
    const expectedFeeRaw = (BigInt(result.plan.fromAmountRaw) - BigInt(result.plan.routeSteps[0].toAmountRaw!)).toString();
    const fee = inspectLifiFeeForwarderCall({ data: decoded.swaps[0].callData,
      token: from.address!, expectedFeeRaw });
    expect(fee.distributions.length).toBeGreaterThan(0);
  }, 20_000);

  it("retains the reviewed Base-to-Arbitrum fee-plus-Across shape without claiming settlement", async () => {
    const adapter = createLifiQuoteAdapter({ policy: {
      allowedTools: new Set(["across", "feecollection"]), allowedExchanges: new Set(),
      allowedBridges: new Set(["across"]), allowedTargets: new Set([diamond]), allowedApprovalTargets: new Set([diamond])
    } });
    const [result] = await adapter.quoteWithPlans({ fromAssetId: from.id, toAssetId: arbitrumUsdc.id,
      amount: "100", fromAddress: wallet, slippageBps: 50 }, { from, to: arbitrumUsdc });
    expect(result.quote).toMatchObject({ provider: "lifi:across", routeKind: "cross_chain" });
    expect(result.quote).not.toHaveProperty("sourceCall");
    expect(result.plan.routeSteps.map((step) => step.type)).toEqual(["protocol", "cross"]);
    const decoded = inspectLifiAcrossV4Call({ data: result.plan.sourceCall.data, recipient: wallet,
      sourceToken: from.address!, destinationToken: arbitrumUsdc.address!, destinationChainId: 42161,
      sourceAmountRaw: result.plan.fromAmountRaw });
    const fee = inspectLifiFeeForwarderCall({ data: decoded.swaps[0].callData, token: from.address!,
      expectedFeeRaw: (BigInt(result.plan.fromAmountRaw) - BigInt(decoded.minimumBridgeAmountRaw)).toString() });
    expect(fee.distributions.map((item) => item.recipient)).toEqual([observedFeeRecipient]);
    expect(decoded.swaps).toHaveLength(1);
    expect(decoded.minimumBridgeAmountRaw).toBe(result.plan.routeSteps[0].toAmountRaw);
    vi.stubEnv("AUREL_LIFI_ALLOWED_TOOLS", "across,feecollection");
    vi.stubEnv("AUREL_LIFI_ALLOWED_EXCHANGES", "");
    vi.stubEnv("AUREL_LIFI_ALLOWED_BRIDGES", "across");
    vi.stubEnv("AUREL_SWAP_ALLOWED_TARGETS", diamond);
    vi.stubEnv("AUREL_SWAP_ALLOWED_SPENDERS", diamond);
    vi.stubEnv("AUREL_SWAP_EXECUTION_POLICY", JSON.stringify({ diamond,
      feeForwarder: observedFeeForwarder, feeRecipients: [observedFeeRecipient], routerSpenders: [] }));
    const plan = result.plan;
    const retained = {
      plan_id: "read-only", subject_reference: "observation", wallet_address: wallet.toLowerCase(),
      source_asset_id: plan.fromAssetId, destination_asset_id: plan.toAssetId,
      source_chain_id: plan.fromChainId, destination_chain_id: plan.toChainId,
      from_amount_raw: plan.fromAmountRaw, recipient: plan.recipient,
      slippage_bps: plan.slippageBps, to_amount_min_raw: plan.toAmountMinRaw,
      quote_id: plan.quoteId, step_id: plan.stepId, tool_id: plan.toolId,
      approval_spender: plan.approvalSpender, route_steps_json: JSON.stringify(plan.routeSteps),
      source_call_json: JSON.stringify(plan.sourceCall), economics_json: JSON.stringify(plan.economics),
      route_policy_version: plan.routePolicyVersion, catalog_version: plan.catalogVersion,
      observed_at: plan.observedAt, expires_at: plan.expiresAt, fingerprint: plan.fingerprint,
      status: "active", intent_id: "observation"
    } satisfies StoredSwapQuotePlan;
    const reviewed = await assertSwapPrepareIntegrity(retained, { from, to: arbitrumUsdc }, Date.now());
    expect(reviewed.sourceCall.to.toLowerCase()).toBe(diamond);
  }, 30_000);
});
