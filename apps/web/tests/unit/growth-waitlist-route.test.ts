import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ validTurnstile: true, configuredTurnstile: true, rateLimited: false, writes: 0, created: true, country: null as unknown }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/security/turnstile", () => ({ verifyTurnstile: async () => ({ valid: state.validTurnstile, configured: state.configuredTurnstile }) }));
vi.mock("@/lib/security/rate-limit", () => {
  class RateLimitError extends Error { retryAfterSeconds = 60; }
  return { RateLimitError, enforceRateLimit: async () => { if (state.rateLimited) throw new RateLimitError("limited"); } };
});
vi.mock("@/lib/growth/waitlist", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/growth/waitlist")>();
  return { ...original, persistWaitlist: async (_db: unknown, _input: unknown, country: unknown) => { state.writes++; state.country = country; return { waitlistId: "id", created: state.created }; } };
});

const input = { email: "person@example.com", privacyNoticeVersion: "2026-09-23" };
const load = () => import("@/app/api/growth/waitlist/route").catch(() => null);
const request = (body: unknown, headers?: Record<string, string>) => new Request("https://aurel.test/api/growth/waitlist", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  Object.assign(state, { validTurnstile: true, configuredTurnstile: true, rateLimited: false, writes: 0, created: true, country: null });
  process.env.GROWTH_WAITLIST_MODE = "open";
  process.env.GROWTH_PRIVACY_NOTICE_VERSION = "2026-09-23";
  process.env.GROWTH_EMAIL_LOOKUP_KEY = "unit-lookup-key";
  process.env.GROWTH_EMAIL_ENCRYPTION_KEY = "unit-encryption-key";
  process.env.PRODUCT_ENVIRONMENT = "production";
});

describe("public waitlist route", () => {
  it("returns the same neutral response for new and duplicate email", async () => {
    const route = await load();
    const first = await route?.POST(request(input));
    state.created = false;
    const duplicate = await route?.POST(request({ ...input, email: " PERSON@example.com " }));
    expect(first?.status).toBe(202);
    expect(duplicate?.status).toBe(202);
    expect(await first?.json()).toEqual(await duplicate?.json());
    expect(state.writes).toBe(2);
  });

  it("rejects missing email without a write", async () => {
    const route = await load();
    expect((await route?.POST(request({ privacyNoticeVersion: "2026-09-23" })))?.status).toBe(400);
    expect(state.writes).toBe(0);
  });

  it("classifies malformed JSON as bad input, not an outage", async () => {
    const route = await load();
    const response = await route?.POST(new Request("https://aurel.test/api/growth/waitlist", { method: "POST", body: "{" }));
    expect(response?.status).toBe(400);
    expect(state.writes).toBe(0);
  });

  it("fails closed when paused or missing an abuse secret", async () => {
    const route = await load();
    process.env.GROWTH_WAITLIST_MODE = "closed";
    expect((await route?.POST(request(input)))?.status).toBe(503);
    process.env.GROWTH_WAITLIST_MODE = "open";
    delete process.env.GROWTH_EMAIL_LOOKUP_KEY;
    expect((await route?.POST(request(input)))?.status).toBe(503);
    expect(state.writes).toBe(0);
  });

  it("rejects bot, stale notice, and rate-limited requests without a write", async () => {
    const route = await load();
    state.validTurnstile = false;
    expect((await route?.POST(request(input)))?.status).toBe(403);
    state.validTurnstile = true;
    expect((await route?.POST(request({ ...input, privacyNoticeVersion: "old" })))?.status).toBe(409);
    state.rateLimited = true;
    expect((await route?.POST(request(input)))?.status).toBe(429);
    expect(state.writes).toBe(0);
  });

  it("does not pass a spoofed country header as trusted metadata", async () => {
    const route = await load();
    await route?.POST(request(input, { "CF-IPCountry": "US" }));
    expect(state.country).toEqual({ countryCode: null, source: "unknown" });
  });
});
