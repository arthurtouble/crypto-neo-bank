import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/lib/security/turnstile";

describe("Turnstile verification", () => {
  const priorSecret = process.env.TURNSTILE_SECRET_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (priorSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = priorSecret;
  });

  it("reports an explicitly unconfigured development environment", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    await expect(verifyTurnstile({})).resolves.toEqual({ configured: false, valid: true });
  });

  it("rejects a missing token when production verification is configured", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    await expect(verifyTurnstile({})).resolves.toEqual({ configured: true, valid: false });
  });

  it("accepts only a successful Siteverify response", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })));
    await expect(verifyTurnstile({ token: "verified-token" })).resolves.toEqual({ configured: true, valid: true });
  });
});
