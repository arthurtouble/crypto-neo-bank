import { beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const state = vi.hoisted(() => ({
  AuthenticationError: httpErrors.AuthenticationError,
  WalletOwnershipError: httpErrors.WalletOwnershipError,
  authenticated: false,
  linked: false,
  previewCalls: 0
}));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: state.AuthenticationError,
  requireVerifiedSubject: async () => { if (!state.authenticated) throw new state.AuthenticationError(); return { subjectReference: "subject-a" }; } }));
vi.mock("@/lib/auth/wallet", () => ({ WalletOwnershipError: state.WalletOwnershipError,
  requireLinkedEvmWallet: async () => { if (!state.linked) throw new state.WalletOwnershipError(); return "0x2222222222222222222222222222222222222222"; } }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: httpErrors.RateLimitError, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/defi/aave-preview", () => ({ previewAaveBaseAction: async () => { state.previewCalls++; return { executionAvailable: false, amountRaw: "1000000" }; } }));

import { POST } from "@/app/api/defi/aave/preview/route";


const body = { action: "supply", sender: "0x2222222222222222222222222222222222222222", symbol: "USDC", amount: "1" };
const request = () => new Request("https://aura.test/api/defi/aave/preview", { method: "POST", body: JSON.stringify(body) });

describe("Aave preview route", () => {
  beforeEach(() => Object.assign(state, { authenticated: false, linked: false, previewCalls: 0 }));

  it("requires authentication and the linked wallet before chain reads", async () => {
    expect((await POST(request())).status).toBe(401);
    state.authenticated = true;
    expect((await POST(request())).status).toBe(403);
    expect(state.previewCalls).toBe(0);
  });

  it("returns only a private, non-executable preview for an owned wallet", async () => {
    state.authenticated = true;
    state.linked = true;
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ executionAvailable: false, amountRaw: "1000000" });
    expect(state.previewCalls).toBe(1);
  });
});
