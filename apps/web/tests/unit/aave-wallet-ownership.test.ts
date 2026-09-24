import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ aaveCalls: 0 }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/auth/server", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireVerifiedSubject: async () => ({ subjectReference: "did:privy:owner" })
}));
vi.mock("@/lib/beta/access", () => ({
  BetaAccessError: class BetaAccessError extends Error {},
  configuredCountries: () => ["PT"],
  requireBetaAccess: async () => ({ mode: "invite", status: "active", countryCode: "PT" })
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
vi.mock("@/lib/defi/aave", () => ({
  prepareAaveBaseAction: async () => { fixture.aaveCalls++; return {}; },
  getAaveBaseRewardClaimPlan: async () => { fixture.aaveCalls++; return {}; }
}));

import { POST as action } from "@/app/api/defi/aave/action/route";
import { POST as rewards } from "@/app/api/defi/aave/rewards/route";

const sender = "0x2222222222222222222222222222222222222222";

describe("Aave unsigned plan wallet boundary", () => {
  it.each([
    ["action", action, { action: "supply", sender, symbol: "USDC", amount: "1" }],
    ["reward claim", rewards, { sender }]
  ])("rejects an unlinked sender for %s before asking Aave for a plan", async (_label, handler, input) => {
    fixture.aaveCalls = 0;
    const response = await handler(new Request("https://aurel.test/api/defi/aave", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fixture.aaveCalls).toBe(0);
  });
});
