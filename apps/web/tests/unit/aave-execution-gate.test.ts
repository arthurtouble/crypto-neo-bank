import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ providerCalls: 0 }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class extends Error {}, requireVerifiedSubject: async () => ({ subjectReference: "subject-a" }) }));
vi.mock("@/lib/beta/access", () => ({ BetaAccessError: class extends Error {}, requireBetaAccess: async () => undefined }));
vi.mock("@/lib/features/flags", () => ({ FeatureUnavailableError: class extends Error {}, requireFeature: async () => undefined }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: class extends Error {}, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/auth/wallet", () => ({ WalletOwnershipError: class extends Error {}, requireLinkedEvmWallet: async () => "0x2222222222222222222222222222222222222222" }));
vi.mock("@/lib/defi/aave", () => ({
  prepareAaveBaseAction: async () => { state.providerCalls++; return { plan: { to: "0x3333333333333333333333333333333333333333", data: "0x1234" } }; },
  getAaveBaseRewardClaimPlan: async () => { state.providerCalls++; return { transaction: { to: "0x3333333333333333333333333333333333333333", data: "0x1234" } }; }
}));

import { POST as action } from "@/app/api/defi/aave/action/route";
import { POST as rewards } from "@/app/api/defi/aave/rewards/route";

describe("Aave executable plan gate", () => {
  it.each([
    ["action", action, { action: "supply", sender: "0x2222222222222222222222222222222222222222", symbol: "USDC", amount: "1" }],
    ["reward claim", rewards, { sender: "0x2222222222222222222222222222222222222222" }]
  ])("never exposes raw %s calldata while governed execution is unavailable", async (_label, handler, body) => {
    state.providerCalls = 0;
    const response = await handler(new Request("https://aurel.test/api/defi/aave", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const data = await response.json();
    expect(data).toMatchObject({ error: "execution_unavailable" });
    expect(JSON.stringify(data)).not.toMatch(/0x1234|"plan"|"transaction"/);
    expect(state.providerCalls).toBe(0);
  });
});
