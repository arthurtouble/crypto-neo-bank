import { describe, expect, it } from "vitest";
import { buildDirectUniswapPlan, validateDirectUniswapPlan, DIRECT_SWAP_ROUTER } from "@/lib/swap/direct-uniswap";
import type { StoredSwapQuotePlan } from "@/lib/swap/plans";

const wallet = "0x000000000000000000000000000000000000dEaD";
const from = { id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453,
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin", decimals: 6,
  logoUrl: null, verification: "verified" as const, eligibility: "eligible" as const };
const to = { id: "8453:0x4200000000000000000000000000000000000006", chainId: 8453,
  address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", decimals: 18,
  logoUrl: null, verification: "verified" as const, eligibility: "eligible" as const };

// Opt-in mainnet reads only. The observation address has no required balance and never signs.
describe.skipIf(process.env.AUREL_LIVE_READONLY !== "1")("direct Base Uniswap read-only route", () => {
  it("quotes both directions of the governed pool and revalidates exact router calls", async () => {
    for (const pair of [{ source: from, destination: to, amount: "10", raw: "10000000" },
      { source: to, destination: from, amount: "0.01", raw: "10000000000000000" }]) {
      const { quote, plan } = await buildDirectUniswapPlan({ fromAssetId: pair.source.id, toAssetId: pair.destination.id,
        amount: pair.amount, fromAddress: wallet, slippageBps: 50 }, { from: pair.source, to: pair.destination });
      const retained = { plan_id: "read-only", subject_reference: "observation", wallet_address: wallet.toLowerCase(),
        source_asset_id: plan.fromAssetId, destination_asset_id: plan.toAssetId,
        source_chain_id: plan.fromChainId, destination_chain_id: plan.toChainId,
        from_amount_raw: plan.fromAmountRaw, recipient: plan.recipient,
        slippage_bps: plan.slippageBps, to_amount_min_raw: plan.toAmountMinRaw,
        quote_id: plan.quoteId, step_id: plan.stepId, tool_id: plan.toolId,
        approval_spender: plan.approvalSpender, route_steps_json: JSON.stringify(plan.routeSteps),
        source_call_json: JSON.stringify(plan.sourceCall), economics_json: JSON.stringify(plan.economics),
        route_policy_version: plan.routePolicyVersion, catalog_version: plan.catalogVersion,
        observed_at: plan.observedAt, expires_at: plan.expiresAt, fingerprint: plan.fingerprint,
        status: "active", intent_id: "observation" } satisfies StoredSwapQuotePlan;
      const reviewed = await validateDirectUniswapPlan(retained, { from: pair.source, to: pair.destination }, Date.now());
      expect(quote.provider).toBe("uniswap:v3:base");
      expect(BigInt(quote.toAmountMinRaw)).toBeGreaterThan(0n);
      expect(reviewed.sourceCall.to.toLowerCase()).toBe(DIRECT_SWAP_ROUTER.toLowerCase());
      expect(reviewed.expectedEffect).toMatchObject({ sourceAmountRaw: pair.raw, recipient: wallet.toLowerCase() });
    }
  }, 60_000);
});
