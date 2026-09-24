import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ authenticated: false, active: false, locked: false, contractChanged: false, shares: 100n * 10n ** 18n }));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(),
  createPublicClient: () => ({ getChainId: async () => 1, readContract: async ({ functionName, address }: {
    functionName: string; address: string }) => {
    if (functionName === "gem") return "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    if (functionName === "dai") return "0xdC035D45d973E3EC169d2276DDab16f1e407384F";
    if (functionName === "savingsToken") return "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD";
    if (functionName === "psm") return state.contractChanged ? "0x2222222222222222222222222222222222222222" : "0xA188EEC8F81263234dA3622A406892F3D630f98c";
    if (functionName === "balanceOf") return address.toLowerCase() === "0xa3931d71877c0e7a3148cb7eb4463524fec27fbd" ? state.shares : 100_000_000n;
    if (functionName === "previewWithdraw") return 13n * 10n ** 18n;
    throw new Error("Unexpected read");
  } }) }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare() { return { bind() { return { async first() { return { account_locked: state.locked ? 1 : 0 }; } }; } }; }
} } }));
vi.mock("@/lib/auth/server", () => {
  class AuthenticationError extends Error {}
  return { AuthenticationError, requireVerifiedSubject: async () => {
    if (!state.authenticated) throw new AuthenticationError();
    return { subjectReference: "subject-a" };
  } };
});
vi.mock("@/lib/beta/access", () => ({ BetaAccessError: class extends Error {},
  configuredCountries: () => ["PT"], requireBetaAccess: async () => ({
    mode: "invite", status: state.active ? "active" : "preview", countryCode: "PT" }) }));
vi.mock("@/lib/auth/wallet", () => ({ WalletOwnershipError: class extends Error {},
  requireLinkedEvmWallet: async (_subject: string, wallet: string) => wallet }));
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: class extends Error {}, enforceRateLimit: async () => undefined }));

import { POST } from "@/app/api/defi/sky/action/route";

const request = (action = "deposit") => new Request("https://aura.test/api/defi/sky/action", { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action,
    sender: "0x1111111111111111111111111111111111111111", amount: "12.5" }) });

describe("Sky wallet action boundary", () => {
  beforeEach(() => Object.assign(state, { authenticated: false, active: false, locked: false,
    contractChanged: false, shares: 100n * 10n ** 18n }));

  it("requires sign-in and an active invitation", async () => {
    expect((await POST(request())).status).toBe(401);
    state.authenticated = true;
    expect((await POST(request())).status).toBe(403);
  });

  it("returns exact Ethereum calls for an unlocked invited wallet", async () => {
    state.authenticated = true; state.active = true;
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ chainId: 1, action: "deposit",
      amountRaw: "12500000", executionAvailable: true,
      approvalCall: { chainId: 1, value: "0" }, vaultCall: { chainId: 1, value: "0" } });
    state.locked = true;
    expect((await POST(request())).status).toBe(403);
  });

  it("prepares USDC withdrawal only against live sUSDS shares and the verified wrapper", async () => {
    state.authenticated = true; state.active = true;
    const result = await POST(request("withdraw"));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ action: "withdraw", amountRaw: "12500000",
      conversionLimitRaw: "12625000000000000000" });
    state.shares = 0n;
    expect((await POST(request("withdraw"))).status).toBe(400);
    state.contractChanged = true;
    expect((await POST(request())).status).toBe(503);
  });
});
