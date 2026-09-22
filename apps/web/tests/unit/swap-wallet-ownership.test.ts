import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ quoteCalls: 0 }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/auth/server", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireVerifiedSubject: async () => ({ subjectReference: "did:privy:owner" })
}));
vi.mock("@/lib/beta/access", () => ({
  BetaAccessError: class BetaAccessError extends Error {},
  requireBetaAccess: async () => undefined
}));
vi.mock("@/lib/features/flags", () => ({
  FeatureUnavailableError: class FeatureUnavailableError extends Error {},
  requireFeature: async () => undefined
}));
vi.mock("@/lib/security/rate-limit", () => ({
  RateLimitError: class RateLimitError extends Error {},
  enforceRateLimit: async () => undefined
}));
vi.mock("@/lib/auth/wallet", () => {
  class WalletOwnershipError extends Error {}
  return { WalletOwnershipError, requireLinkedEvmWallet: async () => { throw new WalletOwnershipError("Unlinked wallet"); } };
});
vi.mock("@/lib/swap/lifi", () => ({
  swapQuoteRequestSchema: { parse: (input: unknown) => input },
  getSwapQuotes: async () => { fixture.quoteCalls++; return { quotes: [] }; }
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
