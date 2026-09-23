import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeFunctionData, parseAbi } from "viem";
import { buildDirectUniswapPlan, validateDirectUniswapPlan, DIRECT_SWAP_ROUTER } from "@/lib/swap/direct-uniswap";
import type { StoredSwapQuotePlan } from "@/lib/swap/plans";

const wallet = "0x1111111111111111111111111111111111111111";
const usdc = { id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453,
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin", decimals: 6,
  logoUrl: null, verification: "verified" as const, eligibility: "eligible" as const };
const weth = { id: "8453:0x4200000000000000000000000000000000000006", chainId: 8453,
  address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", decimals: 18,
  logoUrl: null, verification: "verified" as const, eligibility: "eligible" as const };
const at = Date.parse("2026-09-23T12:00:00.000Z");

function retained(result: Awaited<ReturnType<typeof buildDirectUniswapPlan>>): StoredSwapQuotePlan {
  const plan = result.plan;
  return { plan_id: "plan", subject_reference: "subject", wallet_address: wallet,
    source_asset_id: plan.fromAssetId, destination_asset_id: plan.toAssetId,
    source_chain_id: plan.fromChainId, destination_chain_id: plan.toChainId,
    from_amount_raw: plan.fromAmountRaw, recipient: plan.recipient,
    slippage_bps: plan.slippageBps, to_amount_min_raw: plan.toAmountMinRaw,
    quote_id: plan.quoteId, step_id: plan.stepId, tool_id: plan.toolId,
    approval_spender: plan.approvalSpender, route_steps_json: JSON.stringify(plan.routeSteps),
    source_call_json: JSON.stringify(plan.sourceCall), economics_json: JSON.stringify(plan.economics),
    route_policy_version: plan.routePolicyVersion, catalog_version: plan.catalogVersion,
    observed_at: plan.observedAt, expires_at: plan.expiresAt, fingerprint: plan.fingerprint,
    status: "active", intent_id: "intent" };
}

describe("direct Base Uniswap route", () => {
  it("quotes only the reviewed pool and binds an expiring exact router call", async () => {
    const client = { getChainId: vi.fn().mockResolvedValue(8453),
      getBlock: vi.fn().mockResolvedValue({ number: 100n, hash: `0x${"1".repeat(64)}`, timestamp: BigInt(at / 1000) }),
      readContract: vi.fn().mockResolvedValue("0xb4CB800910B228ED3d0834cF79D697127BBB00e5"),
      call: vi.fn().mockResolvedValue({ data: encodeAbiParameters([{ type: "uint256" }, { type: "uint160" },
        { type: "uint32" }, { type: "uint256" }], [3_741_336_736_481_261n, 0n, 0, 86_270n]) }),
      getCode: vi.fn().mockResolvedValue("0x6000") };
    const result = await buildDirectUniswapPlan({ fromAssetId: usdc.id, toAssetId: weth.id,
      amount: "10", fromAddress: wallet, slippageBps: 50 }, { from: usdc, to: weth },
      { client: client as never, now: () => at, priceUsd: async (assetId) => assetId === usdc.id ? 1 : 2673 });
    expect(result.quote.provider).toBe("uniswap:v3:base");
    expect(result.quote.approvalTarget?.toLowerCase()).toBe(DIRECT_SWAP_ROUTER.toLowerCase());
    const route = await validateDirectUniswapPlan(retained(result), { from: usdc, to: weth }, at + 1_000);
    expect(route.expectedEffect).toMatchObject({ sourceAmountRaw: "10000000", minimumOutputRaw: result.quote.toAmountMinRaw,
      router: DIRECT_SWAP_ROUTER.toLowerCase() });
    expect(route.sourceCall.to.toLowerCase()).toBe(DIRECT_SWAP_ROUTER.toLowerCase());
  });

  it("rejects changed recipient, calldata, deadline, fingerprint, and stale quote", async () => {
    const client = { getChainId: async () => 8453,
      getBlock: async () => ({ number: 100n, hash: `0x${"1".repeat(64)}`, timestamp: BigInt(at / 1000) }),
      readContract: async () => "0xb4CB800910B228ED3d0834cF79D697127BBB00e5",
      call: async () => ({ data: encodeAbiParameters([{ type: "uint256" }, { type: "uint160" },
        { type: "uint32" }, { type: "uint256" }], [3_741_336_736_481_261n, 0n, 0, 86_270n]) }),
      getCode: async () => "0x6000" };
    const result = await buildDirectUniswapPlan({ fromAssetId: usdc.id, toAssetId: weth.id,
      amount: "10", fromAddress: wallet, slippageBps: 50 }, { from: usdc, to: weth },
      { client: client as never, now: () => at, priceUsd: async (id) => id === usdc.id ? 1 : 2673 });
    const plan = retained(result);
    await expect(validateDirectUniswapPlan({ ...plan, recipient: "0x2222222222222222222222222222222222222222" }, { from: usdc, to: weth }, at + 1_000)).rejects.toThrow();
    await expect(validateDirectUniswapPlan({ ...plan, fingerprint: `0x${"0".repeat(64)}` }, { from: usdc, to: weth }, at + 1_000)).rejects.toThrow();
    await expect(validateDirectUniswapPlan(plan, { from: usdc, to: weth }, at + 46_000)).rejects.toThrow();
    const call = JSON.parse(plan.source_call_json) as { data: string };
    const changed = { ...plan, source_call_json: JSON.stringify({ ...call,
      data: encodeFunctionData({ abi: parseAbi(["function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)"]),
        functionName: "multicall", args: [BigInt(at / 1000) + 999n, ["0x1234"]] }) }) };
    await expect(validateDirectUniswapPlan(changed, { from: usdc, to: weth }, at + 1_000)).rejects.toThrow();
  });
});
