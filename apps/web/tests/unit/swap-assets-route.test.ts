import { beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const fixture = vi.hoisted(() => ({
  authenticated: true,
  rateLimited: false,
  providerUnavailable: false,
  imported: true,
  searches: 0
}));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/auth/server", () => {
  const AuthenticationError = httpErrors.AuthenticationError;
  return {
    AuthenticationError,
    requireVerifiedSubject: async () => {
      if (!fixture.authenticated) throw new AuthenticationError();
      return { subjectReference: "did:privy:owner" };
    }
  };
});
vi.mock("@/lib/security/rate-limit", () => {
  const RateLimitError = httpErrors.RateLimitError;
  return {
    RateLimitError,
    enforceRateLimit: async () => { if (fixture.rateLimited) throw new RateLimitError(30); }
  };
});
vi.mock("@/lib/swap/catalog", () => {
  class CatalogUnavailableError extends Error { code = "provider_unavailable"; }
  return {
    CatalogUnavailableError,
    getCatalogPage: async () => {
      fixture.searches++;
      if (fixture.providerUnavailable) throw new CatalogUnavailableError();
      return { assets: [{ id: "8453:native", chainId: 8453, symbol: "ETH", verification: "verified", eligibility: "eligible" }], nextCursor: null, observedAt: "2026-09-22T00:00:00.000Z", source: "LI.FI" };
    },
    resolveCatalogAsset: async () => {
      if (fixture.providerUnavailable) throw new CatalogUnavailableError();
      return fixture.imported ? { id: "8453:0x1111111111111111111111111111111111111111", chainId: 8453, verification: "unverified", eligibility: "eligible" } : null;
    }
  };
});

import { GET } from "@/app/api/swap/assets/route";


function request(query: string) { return GET(new Request(`https://aurel.test/api/swap/assets${query}`)); }

describe("Swap asset catalog API", () => {
  beforeEach(() => {
    fixture.authenticated = true; fixture.rateLimited = false;
    fixture.providerUnavailable = false; fixture.imported = true; fixture.searches = 0;
  });

  it("serves a current, searchable catalog without caching personal responses", async () => {
    const response = await request("?q=ETH&chainIds=8453,1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ assets: [{ id: "8453:native" }], source: "LI.FI" });
  });

  it("imports only a current screened contract and never grants trade permission", async () => {
    const response = await request("?import=8453:0x1111111111111111111111111111111111111111");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.asset).toMatchObject({ verification: "unverified" });
    expect(body).not.toHaveProperty("canTrade");
    fixture.imported = false;
    expect((await request("?import=8453:0x1111111111111111111111111111111111111111")).status).toBe(404);
  });

  it("rejects invalid query, cursor, and unsupported chain before searching", async () => {
    for (const query of ["?q=x&chainIds=56", "?q=x&chainIds=abc", `?q=${"x".repeat(121)}`, "?q=x&cursor=!", "?import=8453:javascript:alert(1)"]) {
      expect((await request(query)).status).toBe(400);
    }
    expect(fixture.searches).toBe(0);
  });

  it("enforces auth, rate limits, and unavailable upstream state", async () => {
    fixture.authenticated = false; expect((await request("?q=ETH")).status).toBe(401);
    fixture.authenticated = true; fixture.rateLimited = true; expect((await request("?q=ETH")).status).toBe(429);
    fixture.rateLimited = false; fixture.providerUnavailable = true; expect((await request("?q=ETH")).status).toBe(503);
  });
});
