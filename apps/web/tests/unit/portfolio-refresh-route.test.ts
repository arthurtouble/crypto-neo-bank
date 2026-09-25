import { beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const state = vi.hoisted(() => ({ authorized: true, accounts: ["8453:0x1111111111111111111111111111111111111111"], scopedReads: 0, ingestCalls: 0, sourceFails: false }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {}, BLOCKSCOUT_API_KEY: "test-key" } }));
vi.mock("@/lib/auth/server", () => {
  const AuthenticationError = httpErrors.AuthenticationError;
  return { AuthenticationError, requireVerifiedSubject: async () => { if (!state.authorized) throw new AuthenticationError("Missing session"); return { subjectReference: "subject-a" }; } };
});
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: httpErrors.RateLimitError, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/portfolio/accounts", () => ({ resolvePortfolioAccounts: async () => { state.scopedReads++; return state.accounts.map((accountId) => ({ accountId })); } }));
vi.mock("@/lib/portfolio/ingest", () => {
  class PortfolioIngestError extends Error { code = "source_unavailable"; }
  return { PortfolioIngestError, ingestOnePage: async () => { state.ingestCalls++; if (state.sourceFails) throw new PortfolioIngestError("offline"); return { nextCursor: "server-token", status: "partial", coveredThrough: null }; } };
});

import { POST } from "@/app/api/portfolio/refresh/route";


const accountId = "8453:0x1111111111111111111111111111111111111111";
function request(body: unknown) { return new Request("https://aurel.test/api/portfolio/refresh", { method: "POST", body: JSON.stringify(body) }); }
beforeEach(() => { state.authorized = true; state.accounts = [accountId]; state.scopedReads = 0; state.ingestCalls = 0; state.sourceFails = false; });

describe("portfolio refresh boundary", () => {
  it("requires authentication and a freshly linked account", async () => {
    state.authorized = false;
    expect((await POST(request({ accountId, sourceId: "blockscout:8453" }))).status).toBe(401);
    state.authorized = true;
    expect((await POST(request({ accountId: "8453:0x2222222222222222222222222222222222222222", sourceId: "blockscout:8453" }))).status).toBe(403);
    expect(state.ingestCalls).toBe(0);
    expect(state.scopedReads).toBe(1);
  });

  it("returns only a server checkpoint and never caches a refresh response", async () => {
    const response = await POST(request({ accountId, sourceId: "blockscout:8453", cursor: null, url: "https://evil.test" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ sourceId: "blockscout:8453", nextCursor: "server-token", status: "partial" });
    expect(state.ingestCalls).toBe(1);
  });

  it("rejects unsupported source and reports provider outage without coverage", async () => {
    expect((await POST(request({ accountId, sourceId: "https://evil.test" }))).status).toBe(400);
    state.sourceFails = true;
    const response = await POST(request({ accountId, sourceId: "blockscout:8453" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
