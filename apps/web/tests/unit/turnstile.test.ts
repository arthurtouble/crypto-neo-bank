import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/lib/security/turnstile";

describe("Turnstile verification", () => {
  const environment = process.env as Record<string, string | undefined>;
  const priorSecret = environment.TURNSTILE_SECRET;
  const priorHostnames = environment.TURNSTILE_HOSTNAMES;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (priorSecret === undefined) delete environment.TURNSTILE_SECRET;
    else environment.TURNSTILE_SECRET = priorSecret;
    if (priorHostnames === undefined) delete environment.TURNSTILE_HOSTNAMES;
    else environment.TURNSTILE_HOSTNAMES = priorHostnames;
  });

  it("reports an explicitly unconfigured development environment", async () => {
    delete environment.TURNSTILE_SECRET;
    await expect(verifyTurnstile({ expectedAction: "support_case" })).resolves.toEqual({ configured: false, valid: true });
  });

  it("rejects a missing token when production verification is configured", async () => {
    environment.TURNSTILE_SECRET = "test-secret";
    environment.TURNSTILE_HOSTNAMES = "aurel.example";
    await expect(verifyTurnstile({ expectedAction: "support_case" })).resolves.toEqual({ configured: true, valid: false });
  });

  it("accepts only a successful Siteverify response", async () => {
    environment.TURNSTILE_SECRET = "test-secret";
    environment.TURNSTILE_HOSTNAMES = "aurel.example";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, action: "support_case", hostname: "aurel.example" }), { status: 200 })));
    await expect(verifyTurnstile({ token: "verified-token", expectedAction: "support_case" })).resolves.toEqual({ configured: true, valid: true });
  });

  it("rejects action and hostname mismatches", async () => {
    environment.TURNSTILE_SECRET = "test-secret";
    environment.TURNSTILE_HOSTNAMES = "aurel.example";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, action: "other", hostname: "attacker.example" }), { status: 200 })));
    await expect(verifyTurnstile({ token: "verified-token", expectedAction: "support_case" })).resolves.toEqual({ configured: true, valid: false });
  });
});
