import { beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const fixture = vi.hoisted(() => ({
  swapsEnabled: true, crossChainEnabled: true,
  walletOwned: true, fromAvailable: true, toAvailable: true,
  fromVerification: "verified" as "verified" | "unverified", quoteCalls: 0, savedPlans: 0, saveFails: false,
  integrityReject: false
}));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/auth/server", () => ({
  AuthenticationError: httpErrors.AuthenticationError,
  requireVerifiedSubject: async () => ({ subjectReference: "did:privy:owner" })
}));
vi.mock("@/lib/security/rate-limit", () => ({
  RateLimitError: httpErrors.RateLimitError, enforceRateLimit: async () => undefined
}));
vi.mock("@/lib/features/flags", () => {
  class FeatureUnavailableError extends Error { constructor(readonly feature: string) { super(); } }
  return {
    FeatureUnavailableError,
    featureEnabled: async (_db: unknown, feature: string) => feature === "swaps" ? fixture.swapsEnabled : fixture.crossChainEnabled,
    requireFeature: async (_db: unknown, feature: string) => {
      if (feature === "swaps" && !fixture.swapsEnabled) throw new FeatureUnavailableError(feature);
      if (feature === "cross_chain" && !fixture.crossChainEnabled) throw new FeatureUnavailableError(feature);
    }
  };
});
vi.mock("@/lib/auth/wallet", () => {
  const WalletOwnershipError = httpErrors.WalletOwnershipError;
  return {
    WalletOwnershipError,
    requireLinkedEvmWallet: async (_subject: string, address: string) => {
      if (!fixture.walletOwned) throw new WalletOwnershipError();
      return address.toLowerCase();
    }
  };
});
vi.mock("@/lib/swap/catalog", () => ({
  resolveCatalogAsset: async (id: string) => {
    const from = id.startsWith("8453:");
    if ((from && !fixture.fromAvailable) || (!from && !fixture.toAvailable)) return null;
    return {
      id, chainId: from ? 8453 : 1, address: from ? "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" : null,
      symbol: from ? "USDC" : "ETH", name: from ? "USD Coin" : "Ether", decimals: from ? 6 : 18,
      logoUrl: null, verification: from ? fixture.fromVerification : "verified", eligibility: "eligible"
    };
  }
}));
vi.mock("@/lib/swap/lifi", () => ({
  getSwapQuotePlans: async () => { fixture.quoteCalls++; return [{
    quote: { quoteId: "q1", planReference: "lifi:q1:fingerprint", toAmountMinRaw: "90" },
    plan: { sourceCall: { chainId: 8453, from: "0x1111111111111111111111111111111111111111", to: "0x3333333333333333333333333333333333333333", value: "0", data: "0x1234" } }
  }]; }
}));
vi.mock("@/lib/swap/plans", () => ({
  saveSwapQuotePlan: async () => { fixture.savedPlans++; if (fixture.saveFails) throw Error("storage unavailable"); return "00000000-0000-4000-8000-000000000001"; }
}));
vi.mock("@/lib/swap/prepare-integrity", () => ({ assertSwapPrepareIntegrity: async () => {
  if (fixture.integrityReject) throw new Error("route not reviewed");
} }));

import { POST } from "@/app/api/swap/quote/route";


const base = {
  fromAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  toAssetId: "1:native", amount: "1", fromAddress: "0x1111111111111111111111111111111111111111", slippageBps: 50
};
function post(body: Record<string, unknown>) {
  return POST(new Request("https://aurel.test/api/swap/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

describe("Swap quote API controls", () => {
  beforeEach(() => {
    fixture.swapsEnabled = true; fixture.crossChainEnabled = true;
    fixture.walletOwned = true; fixture.fromAvailable = true;
    fixture.toAvailable = true; fixture.fromVerification = "verified"; fixture.quoteCalls = 0; fixture.savedPlans = 0; fixture.saveFails = false;
    fixture.integrityReject = false;
  });

  it("returns preview-only cross-network metadata while execution is disabled", async () => {
    fixture.swapsEnabled = false; fixture.crossChainEnabled = false;
    const response = await post(base);
    expect(response.status).toBe(200);
    const body = await response.json() as { reviewAccessAvailable: boolean; quotes: Array<Record<string, unknown>> };
    expect(body).toMatchObject({ reviewAccessAvailable: false, quotes: [{ quoteId: "q1" }] });
    expect(body.quotes[0]).not.toHaveProperty("planId");
    expect(fixture.savedPlans).toBe(0);
  });

  it("marks an enabled route as reviewable without returning a signable call", async () => {
    const response = await post(base);
    expect(response.status).toBe(200);
    const body = await response.json() as { reviewAccessAvailable: boolean };
    expect(body.reviewAccessAvailable).toBe(true);
    expect(JSON.stringify(body)).not.toContain("0x1234");
  });

  it("keeps cross-network quotes quote-only while the cross-network switch is off", async () => {
    fixture.crossChainEnabled = false;
    const response = await post(base);
    expect(response.status).toBe(200);
    const body = await response.json() as { reviewAccessAvailable: boolean; quotes: Array<Record<string, unknown>> };
    expect(body.reviewAccessAvailable).toBe(false);
    expect(body.quotes[0]).not.toHaveProperty("planId");
    expect(fixture.savedPlans).toBe(0);
  });

  it("does not depend on plan storage for a preview-only quote", async () => {
    fixture.swapsEnabled = false;
    fixture.saveFails = true;
    const response = await post(base);
    expect(response.status).toBe(200);
    expect(fixture.savedPlans).toBe(0);
  });


  it("requires a currently owned wallet before requesting a quote", async () => {
    fixture.walletOwned = false;
    const response = await post(base);
    expect(response.status).toBe(403);
    expect(fixture.quoteCalls).toBe(0);
  });

  it("re-resolves both assets and fails closed when either is unavailable", async () => {
    fixture.toAvailable = false;
    const response = await post(base);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "asset_unavailable" });
    expect(fixture.quoteCalls).toBe(0);
  });

  it("requires an exact acknowledgement for every unverified selected asset", async () => {
    fixture.fromVerification = "unverified";
    expect((await post(base)).status).toBe(422);
    expect((await post({ ...base, unverifiedAcknowledgements: [base.fromAssetId, "1:native"] })).status).toBe(422);
    const response = await post({ ...base, unverifiedAcknowledgements: [base.fromAssetId] });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fixture.quoteCalls).toBe(1);
  });

  it("returns an opaque plan ID with public metadata and no executable call", async () => {
    const response = await post(base);
    expect(response.status).toBe(200);
    const body = await response.json() as { quotes: Array<Record<string, unknown>> };
    expect(body.quotes[0]).toMatchObject({ quoteId: "q1", planId: "00000000-0000-4000-8000-000000000001" });
    expect(JSON.stringify(body)).not.toContain("0x1234");
    expect(JSON.stringify(body)).not.toContain("sourceCall");
    expect(fixture.savedPlans).toBe(1);
  });

  it("keeps an unreviewed LI.FI call as a quote-only preview", async () => {
    fixture.integrityReject = true;
    const response = await post(base);
    expect(response.status).toBe(200);
    const body = await response.json() as { quotes: Array<Record<string, unknown>> };
    expect(body.quotes[0]).toMatchObject({ quoteId: "q1" });
    expect(body.quotes[0]).not.toHaveProperty("planId");
    expect(fixture.savedPlans).toBe(0);
  });

  it("withholds quote metadata when its server-held plan cannot be saved", async () => {
    fixture.saveFails = true;
    const response = await post(base);
    expect(response.status).toBe(503);
    expect((await response.json() as { error: string }).error).toBe("quote_unavailable");
  });
});
