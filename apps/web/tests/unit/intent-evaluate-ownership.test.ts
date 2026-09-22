import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/auth/server", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireVerifiedSubject: async () => ({ subjectReference: "did:privy:owner", sessionReference: "session-a" })
}));
vi.mock("@/lib/beta/access", () => ({
  BetaAccessError: class BetaAccessError extends Error {},
  requireBetaAccess: async () => ({ transactionLimitUsd: 25_000 })
}));
vi.mock("@/lib/security/rate-limit", () => ({
  RateLimitError: class RateLimitError extends Error {},
  enforceRateLimit: async () => undefined
}));
vi.mock("@/lib/auth/wallet", () => {
  class WalletOwnershipError extends Error {}
  return {
    WalletOwnershipError,
    requireLinkedEvmWallet: async () => { throw new WalletOwnershipError("This wallet is not linked to your account."); }
  };
});

import { POST } from "@/app/api/intents/evaluate/route";

describe("intent evaluation wallet boundary", () => {
  it("rejects an unlinked wallet before evaluating policy or writing an intent", async () => {
    const response = await POST(new Request("https://aurel.test/api/intents/evaluate", {
      method: "POST",
      body: JSON.stringify({
        type: "transfer",
        walletAddress: "0x2222222222222222222222222222222222222222",
        chainId: 8453,
        asset: "USDC",
        amount: "10",
        destination: "0x3333333333333333333333333333333333333333"
      })
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
