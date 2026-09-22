import { beforeEach, describe, expect, it, vi } from "vitest";

const accountId = "8453:0x1111111111111111111111111111111111111111";
const state = vi.hoisted(() => ({ authorized: true, betaAllowed: true, accounts: ["8453:0x1111111111111111111111111111111111111111"], scopeReads: 0, publishes: 0 }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/auth/server", () => { class AuthenticationError extends Error {} return { AuthenticationError, requireVerifiedSubject: async () => { if (!state.authorized) throw new AuthenticationError(); return { subjectReference: "subject-a" }; } }; });
vi.mock("@/lib/beta/access", () => { class BetaAccessError extends Error { code = "beta_access_required"; } return { BetaAccessError, requireBetaAccess: async () => { if (!state.betaAllowed) throw new BetaAccessError(); } }; });
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: class extends Error {}, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/portfolio/accounts", () => ({ resolvePortfolioAccounts: async () => { state.scopeReads++; return state.accounts.map((item) => ({ accountId: item })); } }));
vi.mock("@/lib/portfolio/materialize", () => { class PortfolioMaterializeError extends Error { code = "incomplete_source"; } return { PortfolioMaterializeError, materializePortfolioDaily: async () => { state.publishes++; return { status: "published", calculationVersion: 1, inputDigest: "abc", days: 7 }; } }; });

import { POST } from "@/app/api/portfolio/materialize/route";
function request(body: unknown = {}) { return new Request("https://aurel.test/api/portfolio/materialize", { method: "POST", body: JSON.stringify(body) }); }
beforeEach(() => { state.authorized = true; state.betaAllowed = true; state.accounts = [accountId]; state.scopeReads = 0; state.publishes = 0; });

describe("portfolio materialization boundary", () => {
  it("requires auth and freshly resolves linked accounts instead of trusting request addresses", async () => {
    state.authorized = false;
    expect((await POST(request())).status).toBe(401);
    state.authorized = true;
    const response = await POST(request({ accountId: "8453:0x2222222222222222222222222222222222222222" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(state.scopeReads).toBe(1);
    expect(state.publishes).toBe(1);
  });
  it("denies non-beta subjects before scope or publication work", async () => {
    state.betaAllowed = false;
    expect((await POST(request())).status).toBe(403);
    expect(state.scopeReads).toBe(0);
    expect(state.publishes).toBe(0);
  });
});
