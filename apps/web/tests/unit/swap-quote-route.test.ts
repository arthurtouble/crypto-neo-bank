import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  crossChainEnabled: true, walletOwned: true, fromAvailable: true, toAvailable: true,
  fromVerification: "verified" as "verified" | "unverified", quoteCalls: 0
}));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/auth/server", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireVerifiedSubject: async () => ({ subjectReference: "did:privy:owner" })
}));
vi.mock("@/lib/beta/access", () => ({
  BetaAccessError: class BetaAccessError extends Error { code = "beta_required"; }, requireBetaAccess: async () => undefined
}));
vi.mock("@/lib/security/rate-limit", () => ({
  RateLimitError: class RateLimitError extends Error { retryAfterSeconds = 30; }, enforceRateLimit: async () => undefined
}));
vi.mock("@/lib/features/flags", () => {
  class FeatureUnavailableError extends Error { constructor(readonly feature: string) { super(); } }
  return {
    FeatureUnavailableError,
    requireFeature: async (_db: unknown, feature: string) => {
      if (feature === "cross_chain" && !fixture.crossChainEnabled) throw new FeatureUnavailableError(feature);
    }
  };
});
vi.mock("@/lib/auth/wallet", () => {
  class WalletOwnershipError extends Error {}
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
  getSwapQuotes: async () => { fixture.quoteCalls++; return [{ quoteId: "q1" }]; }
}));

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
    fixture.crossChainEnabled = true; fixture.walletOwned = true; fixture.fromAvailable = true;
    fixture.toAvailable = true; fixture.fromVerification = "verified"; fixture.quoteCalls = 0;
  });

  it("requires the cross-chain switch before requesting a cross-chain quote", async () => {
    fixture.crossChainEnabled = false;
    const response = await post(base);
    expect(response.status).toBe(503);
    expect(fixture.quoteCalls).toBe(0);
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
});
