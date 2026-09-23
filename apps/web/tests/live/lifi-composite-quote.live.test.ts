import { describe, expect, it } from "vitest";
import { createLifiQuoteAdapter } from "@/lib/swap/lifi";
import type { CatalogAsset } from "@/lib/swap/assets";

const diamond = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
const wallet = "0x000000000000000000000000000000000000dEaD";
const from: CatalogAsset = { id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453,
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin",
  decimals: 6, logoUrl: null, verification: "verified", eligibility: "eligible" };
const to: CatalogAsset = { id: "8453:0x4200000000000000000000000000000000000006", chainId: 8453,
  address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether",
  decimals: 18, logoUrl: null, verification: "verified", eligibility: "eligible" };

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
  }, 20_000);
});
