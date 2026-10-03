import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { VenueError } from "@/lib/markets/types";
import { builderCode, builderCredentials, builderHeaders, hmacSignature, l2Headers, polymarketRequest, polymarketUrl } from "@/lib/markets/polymarket/http";

// Expected values were produced by the official SDK's `buildHmacSignature` (@polymarket/client 0.12.0).
describe("Polymarket request signing", () => {
  it("matches the SDK's HMAC for a body and for a bodiless request", async () => {
    await expect(hmacSignature("c2VjcmV0LWtleS1mb3ItdGVzdHMtb25seQ==", 1700000000, "POST", "/submit", "{\"type\":\"WALLET-CREATE\"}"))
      .resolves.toBe("oaI-xbjNiGeWE9JaptrK_XDVTiDOLC66N9VVzuFADmM=");
    await expect(hmacSignature("AAEC_-8=", 1700000001, "GET", "/data/orders")).resolves.toBe("Od0kujet25pvbHgKaXuvUyeluLNB6NWL5t8lcQQ7Drw=");
  });

  it("builds builder and L2 headers with second timestamps", async () => {
    const now = new Date(1700000001_500);
    const creds = { key: "k", secret: "AAEC_-8=", passphrase: "p" };
    await expect(builderHeaders(creds, "GET", "/data/orders", undefined, now)).resolves.toEqual({
      POLY_BUILDER_API_KEY: "k", POLY_BUILDER_PASSPHRASE: "p", POLY_BUILDER_SIGNATURE: "Od0kujet25pvbHgKaXuvUyeluLNB6NWL5t8lcQQ7Drw=", POLY_BUILDER_TIMESTAMP: "1700000001"
    });
    await expect(l2Headers(creds, "0xOwner", "GET", "/data/orders", undefined, now)).resolves.toEqual({
      POLY_ADDRESS: "0xOwner", POLY_API_KEY: "k", POLY_PASSPHRASE: "p", POLY_SIGNATURE: "Od0kujet25pvbHgKaXuvUyeluLNB6NWL5t8lcQQ7Drw=", POLY_TIMESTAMP: "1700000001"
    });
  });

  it("reads builder secrets and code, refusing partial or malformed configuration", () => {
    expect(() => builderCredentials({ POLYMARKET_BUILDER_API_KEY: "k" })).toThrow(VenueError);
    expect(builderCredentials({ POLYMARKET_BUILDER_API_KEY: "k", POLYMARKET_BUILDER_SECRET: "s", POLYMARKET_BUILDER_PASSPHRASE: "p" })).toEqual({ key: "k", secret: "s", passphrase: "p" });
    expect(builderCode({})).toBe(`0x${"0".repeat(64)}`);
    expect(builderCode({ POLYMARKET_BUILDER_CODE: `0x${"AB".repeat(32)}` })).toBe(`0x${"ab".repeat(32)}`);
    expect(() => builderCode({ POLYMARKET_BUILDER_CODE: "0x1234" })).toThrow(VenueError);
  });
});

describe("Polymarket base URLs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses production hosts unless a loopback fake is configured", () => {
    expect(polymarketUrl("clob")).toBe("https://clob.polymarket.com");
    vi.stubEnv("POLYMARKET_CLOB_URL", "https://evil.example");
    expect(polymarketUrl("clob")).toBe("https://clob.polymarket.com");
    vi.stubEnv("POLYMARKET_CLOB_URL", "http://127.0.0.1:4100/");
    expect(polymarketUrl("clob")).toBe("http://127.0.0.1:4100");
    expect(polymarketUrl("bridge")).toBe("https://bridge.polymarket.com");
  });
});

describe("Polymarket requests", () => {
  const schema = z.object({ ok: z.literal(true) });

  it("signs the exact serialized body and validates the answer", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, extra: 1 })) as unknown as typeof fetch;
    const sign = vi.fn(async () => ({ SIGNED: "yes" }));
    await expect(polymarketRequest({ service: "relayer", method: "POST", path: "/submit", body: { b: 1, a: [2] }, sign, schema, fetcher })).resolves.toEqual({ ok: true });
    expect(sign).toHaveBeenCalledWith("POST", "/submit", "{\"b\":1,\"a\":[2]}");
    const [url, init] = vi.mocked(fetcher).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://relayer-v2.polymarket.com/submit");
    expect(init.body).toBe("{\"b\":1,\"a\":[2]}");
    expect(init.headers).toMatchObject({ SIGNED: "yes", "content-type": "application/json" });
  });

  it.each([
    [429, {}, "rate_limited"],
    [503, {}, "unavailable"],
    [404, { error: "market not found" }, "not_found"],
    [401, { error: "Unauthorized/Invalid api key" }, "unauthorized"],
    [400, { error: "batch nonce 3 does not match on-chain nonce 4" }, "rejected"]
  ])("maps HTTP %s to %s, keeping Polymarket's message on rejections", async (status, body, code) => {
    const fetcher = vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;
    const error = await polymarketRequest({ service: "clob", path: "/x", schema, fetcher }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VenueError);
    expect((error as VenueError).code).toBe(code);
    if (code === "rejected") expect((error as VenueError).message).toContain("on-chain nonce 4");
  });

  it("treats network failures and unexpected answers as unavailable or invalid", async () => {
    const down = vi.fn(async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    await expect(polymarketRequest({ service: "gamma", path: "/x", schema, fetcher: down })).rejects.toMatchObject({ code: "unavailable" });
    const odd = vi.fn(async () => Response.json({ ok: "nope" })) as unknown as typeof fetch;
    await expect(polymarketRequest({ service: "gamma", path: "/x", schema, fetcher: odd })).rejects.toMatchObject({ code: "invalid_response" });
  });
});
