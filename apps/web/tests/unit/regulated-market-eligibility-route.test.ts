import { describe, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ env: {} }));
import { createEligibilityHandler } from "@/app/api/markets/eligibility/route";
import { BetaAccessError } from "@/lib/beta/access";
import { createUnavailableEligibilityProvider } from "@/lib/markets/eligibility-provider";
import { RateLimitError } from "@/lib/security/rate-limit";

const policy = {
  instrumentId: "xstocks:issuer-aapl", allowedCountries: [], blockedCountries: [], provenance: "reviewed_country_matrix_not_connected",
  reviewedAt: null, expiresAt: "2027-01-01T00:00:00.000Z", venue: null, requiredDocuments: []
};

describe("regulated eligibility API", () => {
  it("returns a subject-bound fail-closed provider decision without accepting a profile country", async () => {
    const GET = createEligibilityHandler({
      authenticate: async () => ({ subjectReference: "did:privy:subject-1" }),
      requireAccess: async () => undefined, rateLimit: async () => undefined,
      resolvePolicy: async () => policy,
      provider: createUnavailableEligibilityProvider(() => Date.parse("2026-09-22T12:00:00.000Z")),
      acknowledgements: async () => [], now: () => Date.parse("2026-09-22T12:00:00.000Z")
    });
    const response = await GET(new Request("https://aurel.example/api/markets/eligibility?instrumentId=xstocks%3Aissuer-aapl"));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ permissions: { canQuote: false, canOrder: false, canHold: false, canTransfer: false }, reasons: ["partner_not_connected"] });

    const countryInjection = await GET(new Request("https://aurel.example/api/markets/eligibility?instrumentId=xstocks%3Aissuer-aapl&country=PT"));
    expect(countryInjection.status).toBe(400);
  });

  it("fails closed when the eligibility provider is unreachable", async () => {
    const GET = createEligibilityHandler({
      authenticate: async () => ({ subjectReference: "did:privy:subject-1" }), resolvePolicy: async () => policy,
      requireAccess: async () => undefined, rateLimit: async () => undefined,
      provider: { evaluate: async () => { throw new Error("offline"); } }, acknowledgements: async () => [], now: () => Date.parse("2026-09-22T12:00:00.000Z")
    });
    const response = await GET(new Request("https://aurel.example/api/markets/eligibility?instrumentId=xstocks%3Aissuer-aapl"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "eligibility_unavailable" });
  });

  it("denies accounts without private-beta access before consulting eligibility providers", async () => {
    const GET = createEligibilityHandler({
      authenticate: async () => ({ subjectReference: "did:privy:subject-1" }),
      requireAccess: async () => { throw new BetaAccessError("invite_required", "Invitation required."); },
      rateLimit: async () => undefined, resolvePolicy: async () => policy,
      provider: { evaluate: async () => { throw new Error("provider must not be called"); } },
      acknowledgements: async () => [], now: () => Date.parse("2026-09-22T12:00:00.000Z")
    });
    const response = await GET(new Request("https://aurel.example/api/markets/eligibility?instrumentId=xstocks%3Aissuer-aapl"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "invite_required" });
  });

  it("rate limits eligibility checks by authenticated subject before consulting providers", async () => {
    const GET = createEligibilityHandler({
      authenticate: async () => ({ subjectReference: "did:privy:subject-1" }),
      requireAccess: async () => undefined, rateLimit: async () => { throw new RateLimitError(42); },
      resolvePolicy: async () => policy,
      provider: { evaluate: async () => { throw new Error("provider must not be called"); } },
      acknowledgements: async () => [], now: () => Date.parse("2026-09-22T12:00:00.000Z")
    });
    const response = await GET(new Request("https://aurel.example/api/markets/eligibility?instrumentId=xstocks%3Aissuer-aapl"));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await response.json()).toMatchObject({ error: "rate_limited" });
  });
});
