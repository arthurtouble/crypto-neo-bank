import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredSwapQuotePlan } from "@/lib/swap/plans";
import { assertSwapPrepareIntegrity } from "@/lib/swap/prepare-integrity";

const wallet = "0x1111111111111111111111111111111111111111";
const diamond = "0x2222222222222222222222222222222222222222";
const source = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const destination = "8453:0x4200000000000000000000000000000000000006";
const now = Date.parse("2026-09-23T12:00:00.000Z");
const from = { id: source, chainId: 8453, address: source.split(":")[1], symbol: "USDC", name: "USD Coin",
  decimals: 6, logoUrl: null, verification: "verified" as const, eligibility: "eligible" as const };
const to = { id: destination, chainId: 8453, address: destination.split(":")[1], symbol: "WETH", name: "Wrapped Ether",
  decimals: 18, logoUrl: null, verification: "verified" as const, eligibility: "eligible" as const };
const arbitrum = { ...from, id: "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  chainId: 42161, address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" };

vi.mock("@/lib/swap/governed-route", () => ({ validateGovernedSameChainPlan: (plan: StoredSwapQuotePlan) => ({
  sourceCall: JSON.parse(plan.source_call_json), expectedEffect: { wallet, sourceAssetId: source,
    destinationAssetId: destination, sourceAmountRaw: "1000000", minimumOutputRaw: "900000", recipient: wallet }
}) }));
vi.mock("@/lib/swap/governed-across-route", () => ({ validateGovernedAcrossPlan: (plan: StoredSwapQuotePlan) => ({
  sourceCall: JSON.parse(plan.source_call_json), expectedSourceEffect: { wallet, bridgeAmountRaw: "997500" },
  expectedDestinationEffect: { recipient: wallet, minimumOutputRaw: "900000" }
}) }));

async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return `0x${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function fixture(): Promise<StoredSwapQuotePlan> {
  const routePolicyVersion = await hash([["uniswap"], ["uniswap"], [], [diamond], [diamond]]);
  const catalogVersion = await hash([from, to]);
  const expiresAt = new Date(now + 45_000).toISOString();
  const economics = { toAmountRaw: "950000" };
  const steps = [{ id: "fee", type: "protocol", tool: "feeCollection" }, { id: "quote-1", type: "swap", tool: "uniswap" }];
  const fingerprint = await hash(["lifi", "uniswap", "quote-1", source, destination, "1000000", "950000", "900000",
    wallet, wallet, 0.005, 8453, diamond, "0", "0x1234", diamond, null, null,
    expiresAt, routePolicyVersion, catalogVersion, steps, economics]);
  return { plan_id: "plan-1", subject_reference: "subject-a", wallet_address: wallet,
    source_asset_id: source, destination_asset_id: destination, source_chain_id: 8453, destination_chain_id: 8453,
    from_amount_raw: "1000000", recipient: wallet, slippage_bps: 50, to_amount_min_raw: "900000",
    quote_id: "quote-1", step_id: "quote-1", tool_id: "uniswap", approval_spender: diamond,
    route_steps_json: JSON.stringify(steps), source_call_json: JSON.stringify({ chainId: 8453, from: wallet,
      to: diamond, value: "0", data: "0x1234" }), economics_json: JSON.stringify(economics),
    route_policy_version: routePolicyVersion, catalog_version: catalogVersion,
    observed_at: new Date(now - 1_000).toISOString(), expires_at: expiresAt,
    fingerprint, status: "active", intent_id: "intent-1" };
}

describe("stored Swap preparation integrity", () => {
  beforeEach(() => {
    vi.stubEnv("AUREL_LIFI_ALLOWED_TOOLS", "uniswap");
    vi.stubEnv("AUREL_LIFI_ALLOWED_EXCHANGES", "uniswap");
    vi.stubEnv("AUREL_LIFI_ALLOWED_BRIDGES", "");
    vi.stubEnv("AUREL_SWAP_ALLOWED_TARGETS", diamond);
    vi.stubEnv("AUREL_SWAP_ALLOWED_SPENDERS", diamond);
    vi.stubEnv("AUREL_SWAP_EXECUTION_POLICY", JSON.stringify({ diamond,
      feeForwarder: "0x3333333333333333333333333333333333333333",
      feeRecipients: ["0x4444444444444444444444444444444444444444"],
      routerSpenders: [{ router: "0x5555555555555555555555555555555555555555",
        spender: "0x5555555555555555555555555555555555555555", feeTiers: [3000] }] }));
  });

  it("rebinds the retained quote to current policy, catalog, and exact fingerprint", async () => {
    const plan = await fixture();
    expect((await assertSwapPrepareIntegrity(plan, { from, to }, now)).reviewedSpender).toBe(diamond);
    await expect(assertSwapPrepareIntegrity({ ...plan, fingerprint: `0x${"0".repeat(64)}` }, { from, to }, now)).rejects.toThrow();
  });

  it("fails closed when current operator policy or catalog metadata changes", async () => {
    const plan = await fixture();
    vi.stubEnv("AUREL_LIFI_ALLOWED_EXCHANGES", "sushiswap");
    await expect(assertSwapPrepareIntegrity(plan, { from, to }, now)).rejects.toThrow();
    vi.stubEnv("AUREL_LIFI_ALLOWED_EXCHANGES", "uniswap");
    await expect(assertSwapPrepareIntegrity(plan, { from, to: { ...to, decimals: 17 } }, now)).rejects.toThrow();
  });

  it("rebinds a reviewed bridge to the bridge allowlist and the retained fingerprint", async () => {
    vi.stubEnv("AUREL_SWAP_EXECUTION_POLICY", JSON.stringify({ diamond,
      feeForwarder: "0x3333333333333333333333333333333333333333",
      feeRecipients: ["0x4444444444444444444444444444444444444444"], routerSpenders: [] }));
    vi.stubEnv("AUREL_LIFI_ALLOWED_TOOLS", "across,feecollection");
    vi.stubEnv("AUREL_LIFI_ALLOWED_EXCHANGES", "");
    vi.stubEnv("AUREL_LIFI_ALLOWED_BRIDGES", "across");
    const plan = await fixture();
    plan.destination_asset_id = arbitrum.id;
    plan.destination_chain_id = 42161;
    plan.tool_id = "across";
    plan.route_steps_json = JSON.stringify([{ id: "fee", type: "protocol", tool: "feeCollection" },
      { id: "quote-1", type: "cross", tool: "across" }]);
    plan.route_policy_version = await hash([["across", "feecollection"], [], ["across"], [diamond], [diamond]]);
    plan.catalog_version = await hash([from, arbitrum]);
    plan.fingerprint = await hash(["lifi", "across", "quote-1", source, arbitrum.id,
      "1000000", "950000", "900000", wallet, wallet, 0.005, 8453, diamond,
      "0", "0x1234", diamond, null, null, plan.expires_at, plan.route_policy_version,
      plan.catalog_version, JSON.parse(plan.route_steps_json), JSON.parse(plan.economics_json!)]);
    const result = await assertSwapPrepareIntegrity(plan, { from, to: arbitrum }, now);
    expect(result).toMatchObject({ reviewedSpender: diamond,
      expectedSourceEffect: { bridgeAmountRaw: "997500" } });
    await expect(assertSwapPrepareIntegrity({ ...plan, fingerprint: "0xwrong" },
      { from, to: arbitrum }, now)).rejects.toThrow();
    vi.stubEnv("AUREL_LIFI_ALLOWED_BRIDGES", "");
    await expect(assertSwapPrepareIntegrity(plan, { from, to: arbitrum }, now)).rejects.toThrow();
  });
});
