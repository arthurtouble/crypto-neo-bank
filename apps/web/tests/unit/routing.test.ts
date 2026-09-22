import { afterEach, describe, expect, it, vi } from "vitest";
import { getUsdcRoute, routeQuoteIsFresh, routeRequestSchema } from "@/lib/routing/lifi";

const address = "0x1111111111111111111111111111111111111111";
const baseQuote = {
  id: "route-1",
  tool: "test",
  action: {
    fromChainId: 1,
    toChainId: 8453,
    fromToken: { symbol: "USDC", decimals: 6, chainId: 1, address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
    toToken: { symbol: "USDC", decimals: 6, chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }
  },
  estimate: { fromAmount: "10000000", toAmount: "9990000", toAmountMin: "9940000" },
  transactionRequest: { to: "0x2222222222222222222222222222222222222222", data: "0x1234", value: "0", chainId: 1 }
};

afterEach(() => vi.restoreAllMocks());

describe("LI.FI route input", () => {
  it("accepts supported mainnet USDC routes", () => expect(routeRequestSchema.parse({ fromChainId: 1, toChainId: 8453, amount: "100.25", fromAddress: "0x1111111111111111111111111111111111111111" }).amount).toBe("100.25"));
  it("accepts a distinct destination for withdrawals", () => expect(routeRequestSchema.parse({ fromChainId: 8453, toChainId: 1, amount: "25", fromAddress: "0x1111111111111111111111111111111111111111", toAddress: "0x2222222222222222222222222222222222222222" }).toAddress).toBe("0x2222222222222222222222222222222222222222"));
  it("rejects same-chain and unsupported routes", () => {
    expect(() => routeRequestSchema.parse({ fromChainId: 8453, toChainId: 8453, amount: "10", fromAddress: "0x1111111111111111111111111111111111111111" })).toThrow();
    expect(() => routeRequestSchema.parse({ fromChainId: 56, toChainId: 8453, amount: "10", fromAddress: "0x1111111111111111111111111111111111111111" })).toThrow();
  });
  it("rejects an expired or malformed quote before execution", () => {
    expect(routeQuoteIsFresh("2026-09-22T12:01:00.000Z", Date.parse("2026-09-22T12:00:59.000Z"))).toBe(true);
    expect(routeQuoteIsFresh("2026-09-22T12:01:00.000Z", Date.parse("2026-09-22T12:01:00.000Z"))).toBe(false);
    expect(routeQuoteIsFresh("not-a-date")).toBe(false);
  });
  it("accepts a provider response only when its authoritative fields match the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(baseQuote), { status: 200 })));
    const result = await getUsdcRoute({ fromChainId: 1, toChainId: 8453, amount: "10", fromAddress: address });
    expect(result.quote.id).toBe("route-1");
    expect(routeQuoteIsFresh(result.expiresAt)).toBe(true);
  });
  it("rejects a provider response with a substituted amount", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...baseQuote, estimate: { ...baseQuote.estimate, fromAmount: "9000000" } }), { status: 200 })));
    await expect(getUsdcRoute({ fromChainId: 1, toChainId: 8453, amount: "10", fromAddress: address })).rejects.toThrow("requested amount");
  });
});
