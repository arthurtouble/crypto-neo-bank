import { describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

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
import { POST as action } from "@/app/api/defi/aave/action/route";


const sender = "0x2222222222222222222222222222222222222222";

describe("Aave wallet boundary", () => {
  it.each([
    ["action", action, { action: "supply", sender, symbol: "USDC", amount: "1" }]
  ])("rejects an unlinked sender for %s", async (_label, handler, input) => {
    const response = await handler(new Request("https://aurel.test/api/defi/aave", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
