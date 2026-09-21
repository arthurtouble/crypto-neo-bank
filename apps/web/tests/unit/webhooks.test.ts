import { describe, expect, it } from "vitest";
import { sha256Hex, verifyProviderSignature } from "../../src/lib/platform/events";

async function sign(timestamp: string, body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return `v1=${[...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

describe("provider webhook security", () => {
  it("accepts a current valid HMAC and rejects tampering", async () => {
    const body = JSON.stringify({ id: "event-001" });
    const secret = "local-test-secret";
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000));
    const signature = await sign(timestamp, body, secret);
    expect(await verifyProviderSignature({ rawBody: body, timestamp, signature, secret, toleranceSeconds: 300, now })).toBe(true);
    expect(await verifyProviderSignature({ rawBody: `${body}x`, timestamp, signature, secret, toleranceSeconds: 300, now })).toBe(false);
  });

  it("rejects replayed timestamps outside the tolerance window", async () => {
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000) - 301);
    const signature = await sign(timestamp, "{}", "secret");
    expect(await verifyProviderSignature({ rawBody: "{}", timestamp, signature, secret: "secret", toleranceSeconds: 300, now })).toBe(false);
  });

  it("creates stable payload fingerprints", async () => {
    expect(await sha256Hex("aurel")).toMatch(/^[a-f0-9]{64}$/);
    expect(await sha256Hex("aurel")).toBe(await sha256Hex("aurel"));
  });
});
