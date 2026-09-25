import { describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const fixture = vi.hoisted(() => ({ quoteCalls: 0 }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/auth/server", () => ({
  AuthenticationError: httpErrors.AuthenticationError,
  requireVerifiedSubject: async () => ({ subjectReference: "did:privy:owner" })
}));
vi.mock("@/lib/features/flags", () => ({
  FeatureUnavailableError: httpErrors.FeatureUnavailableError,
  requireFeature: async () => undefined
}));
vi.mock("@/lib/security/rate-limit", () => ({
  RateLimitError: httpErrors.RateLimitError,
  enforceRateLimit: async () => undefined
}));
vi.mock("@/lib/auth/wallet", () => {
  const WalletOwnershipError = httpErrors.WalletOwnershipError;
  return { WalletOwnershipError, requireLinkedEvmWallet: async () => { throw new WalletOwnershipError("Unlinked wallet"); } };
});
vi.mock("@/lib/swap/quotes", async (original) => ({
  ...await original<typeof import("@/lib/swap/quotes")>(),
  swapQuoteRequestSchema: { parse: (input: unknown) => input }
}));
vi.mock("@/lib/swap/catalog", () => ({
  resolveCatalogAsset: async () => ({ id: "8453:native", chainId: 8453, verification: "verified", eligibility: "eligible" })
}));
vi.mock("@/lib/swap/lifi", () => ({
  getSwapQuotePlans: async () => { fixture.quoteCalls++; return []; }
}));

import { POST } from "@/app/api/swap/quote/route";


describe("swap quote wallet boundary", () => {
  it("refuses a quote for a wallet that is not linked to the session", async () => {
    fixture.quoteCalls = 0;
    const response = await POST(new Request("https://aurel.test/api/swap/quote", {
      method: "POST",
      body: JSON.stringify({ fromAssetId: "USDC", toAssetId: "ETH", amount: "1", fromAddress: "0x2222222222222222222222222222222222222222" })
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fixture.quoteCalls).toBe(0);
  });
});
