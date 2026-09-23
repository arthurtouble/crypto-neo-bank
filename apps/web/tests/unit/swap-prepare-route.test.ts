import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = "0x1111111111111111111111111111111111111111";
const intentId = "00000000-0000-4000-8000-000000000002";
const planId = "00000000-0000-4000-8000-000000000001";
const source = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const destination = "8453:0x4200000000000000000000000000000000000006";
const fixture = vi.hoisted(() => ({
  planIntent: "00000000-0000-4000-8000-000000000002", intentStatus: "reviewed", intentType: "swap", locked: false,
  allowance: "sufficient", routeValid: true, simulationValid: true, changes: 1,
  countries: ["US"] as string[], inserted: [] as string[], simulationCalls: 0
}));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(sql: string) { return { bind() { return {
    async first() {
      if (sql.includes("FROM transaction_intents") && sql.includes("WHERE intent_id =")) return {
        intent_id: intentId, intent_type: fixture.intentType, chain_id: 8453,
        wallet_reference: `wallet:${wallet}`, route_reference: `swap-plan:${planId}`,
        request_json: JSON.stringify({ type: "swap", walletAddress: wallet, chainId: 8453,
          asset: source, amount: "1", amountRaw: "1000000", destination: wallet,
          destinationChainId: 8453, destinationAssetId: destination, toAmountMinRaw: "900000", planId }),
        policy_result_json: JSON.stringify({ permitted: true }), status: fixture.intentStatus,
        expires_at: new Date(Date.now() + 45_000).toISOString()
      };
      if (sql.includes("security_profiles")) return { account_locked: fixture.locked ? 1 : 0,
        enforce_address_book: 0, daily_limit_usd: 25_000, new_address_threshold_usd: 1_000,
        step_up_threshold_usd: 10_000, new_address_delay_seconds: 86_400 };
      if (sql.includes("spent_cents")) return { spent_cents: 0, missing: 0 };
      return null;
    }, async run() { if (sql.includes("INSERT INTO intent_prepared_calls")) fixture.inserted.push(sql);
      return { meta: { changes: sql.includes("INSERT INTO intent_prepared_calls") ? fixture.changes : 1 } }; }
  }; } }; },
  async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map((statement) => statement.run())); }
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class AuthenticationError extends Error {},
  requireVerifiedSubject: async () => ({ subjectReference: "did:privy:owner" }) }));
vi.mock("@/lib/auth/wallet", () => ({ WalletOwnershipError: class WalletOwnershipError extends Error {},
  requireLinkedEvmWallet: async () => wallet }));
vi.mock("@/lib/beta/access", () => ({ BetaAccessError: class BetaAccessError extends Error {},
  configuredCountries: () => fixture.countries,
  requireBetaAccess: async () => ({ mode: "invite", status: "active", countryCode: "US", transactionLimitUsd: 25_000 }) }));
vi.mock("@/lib/features/flags", () => ({ FeatureUnavailableError: class FeatureUnavailableError extends Error {}, requireFeature: async () => undefined }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: class RateLimitError extends Error {}, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/swap/plans", () => ({ getActiveSwapQuotePlan: async () => ({
  plan_id: planId, intent_id: fixture.planIntent, subject_reference: "did:privy:owner", wallet_address: wallet,
  source_asset_id: source, destination_asset_id: destination, source_chain_id: 8453, destination_chain_id: 8453,
  from_amount_raw: "1000000", to_amount_min_raw: "900000", recipient: wallet,
  source_call_json: JSON.stringify({ chainId: 8453, from: wallet, to: "0x2222222222222222222222222222222222222222", value: "0", data: "0x1234" }),
  expires_at: new Date(Date.now() + 45_000).toISOString(), status: "active", approval_spender: "0x2222222222222222222222222222222222222222"
}) }));
vi.mock("@/lib/swap/catalog", () => ({ resolveCatalogAsset: async (id: string) => ({ id, chainId: 8453,
  address: id.split(":")[1], symbol: id === source ? "USDC" : "WETH", name: id === source ? "USD Coin" : "Wrapped Ether",
  decimals: id === source ? 6 : 18, logoUrl: null, verification: "verified", eligibility: "eligible" }) }));
vi.mock("@/lib/swap/prepare-integrity", () => ({ assertSwapPrepareIntegrity: async () => { if (!fixture.routeValid) throw new Error("bad route");
  return { sourceCall: { chainId: 8453, from: wallet, to: "0x2222222222222222222222222222222222222222", value: "0", data: "0x1234" },
    expectedEffect: { wallet, sourceAssetId: source, destinationAssetId: destination,
      sourceAmountRaw: "1000000", minimumOutputRaw: "900000", recipient: wallet }, reviewedSpender: "0x2222222222222222222222222222222222222222" }; } }));
vi.mock("@/lib/swap/approval-steps", () => ({ observeNextSwapApproval: async () => ({ kind: fixture.allowance }) }));
vi.mock("@/lib/swap/source-balance", () => ({ observeSwapSourceBalance: async () => ({ chainId: 8453, wallet, assetId: source,
  amountRaw: "1000000", balanceRaw: "2000000", blockNumber: 1n, blockHash: `0x${"a".repeat(64)}`, observedAtMs: Date.now() }) }));
vi.mock("@/lib/swap/simulation", () => ({ observeSwapExecutionBudget: async () => { fixture.simulationCalls++;
  if (!fixture.simulationValid) throw new Error("simulation failed"); return { signingReady: false }; } }));
vi.mock("@/lib/transactions/valuation", () => ({ ValuationError: class ValuationError extends Error {}, valueSwapSource: async () => ({
  assetId: source, rawUnits: "1000000", decimals: 6, priceUsd: "1", marketPriceUsd: "1", priceSource: "kraken",
  priceObservedAt: new Date().toISOString(), valuedAt: new Date().toISOString(), usdCents: "100", policyVersion: 1,
  depegUncertainty: false }) }));
vi.mock("@/lib/transactions/policy", () => ({ evaluateTransactionPolicy: () => ({ permitted: true,
  requiresStepUp: false, requiresWalletConfirmation: true, findings: [] }) }));
vi.mock("viem", async (importOriginal) => { const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: () => ({}) }; });

import { POST } from "@/app/api/swap/prepare/route";

function post(body: Record<string, unknown> = { intentId, planId, walletAddress: wallet }) {
  return POST(new Request("https://aurel.test/api/swap/prepare", { method: "POST", body: JSON.stringify(body) }));
}

describe("governed Swap preparation boundary", () => {
  beforeEach(() => { Object.assign(fixture, { planIntent: intentId, intentStatus: "reviewed", intentType: "swap",
    locked: false, allowance: "sufficient", routeValid: true, simulationValid: true, changes: 1,
    countries: ["US"], inserted: [], simulationCalls: 0 }); });

  it("rejects browser-authored calldata", async () => {
    expect((await post({ intentId, planId, walletAddress: wallet, call: { data: "0xdeadbeef" } })).status).toBe(400);
    expect(fixture.inserted).toHaveLength(0);
  });

  it("rejects an orphan or different reviewed intent before preparing", async () => {
    fixture.planIntent = "00000000-0000-4000-8000-000000000099";
    expect((await post()).status).toBe(409);
    expect(fixture.inserted).toHaveLength(0);
  });

  it("refuses unsupported routes and insufficient allowance without writing a call", async () => {
    fixture.routeValid = false;
    expect((await post()).status).toBe(422);
    fixture.routeValid = true; fixture.allowance = "approve";
    expect((await post()).status).toBe(409);
    expect(fixture.inserted).toHaveLength(0);
  });

  it("refuses account lock and a country without explicit allowance", async () => {
    fixture.locked = true;
    expect((await post()).status).toBe(403);
    fixture.locked = false; fixture.countries = [];
    expect((await post()).status).toBe(403);
    expect(fixture.inserted).toHaveLength(0);
  });

  it("stores the exact simulated server-held call once, then returns it for deliberate wallet confirmation", async () => {
    const response = await post();
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    expect(await response.json()).toMatchObject({ intentId, stepIndex: 0, call: { data: "0x1234", from: wallet } });
    expect(fixture.simulationCalls).toBe(1);
    expect(fixture.inserted).toHaveLength(1);
    expect(fixture.inserted[0]).toContain("submission_phase");
  });

  it("never returns executable calldata if the conditional insert loses a race", async () => {
    fixture.changes = 0;
    const response = await post();
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("0x1234");
  });
});
