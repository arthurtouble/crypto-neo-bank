import { afterEach, describe, expect, it, vi } from "vitest";
import { getSwapQuotes } from "@/lib/swap/lifi";
import { SWAP_ASSETS } from "@/config/swap-assets";

const wallet = "0x1111111111111111111111111111111111111111";
const input = { fromAssetId: "USDC" as const, toAssetId: "ETH" as const, amount: "1", fromAddress: wallet, slippageBps: 50 };

function providerQuote(tool: string) {
  return {
    id: `quote-${tool}`, tool,
    action: {
      fromChainId: 8453, toChainId: 8453,
      fromToken: { symbol: "USDC", decimals: 6, chainId: 8453, address: SWAP_ASSETS.USDC.address },
      toToken: { symbol: "ETH", decimals: 18, chainId: 8453, address: SWAP_ASSETS.ETH.address }
    },
    estimate: { fromAmount: "1000000", toAmount: "300000000000000", toAmountMin: "290000000000000", approvalAddress: "0x2222222222222222222222222222222222222222" },
    transactionRequest: { to: "0x3333333333333333333333333333333333333333", data: "0x1234", value: "0", chainId: 8453 }
  };
}

function stubQuotes(mutate: (quote: ReturnType<typeof providerQuote>) => void) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const tool = new URL(url).searchParams.get("allowExchanges") ?? "1inch";
    const quote = providerQuote(tool);
    mutate(quote);
    return Response.json(quote);
  }));
}

describe("LI.FI swap quote integrity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts an exact raw amount and positive bounded minimum", async () => {
    stubQuotes(() => undefined);
    const result = await getSwapQuotes(input);
    expect(result.quotes).toHaveLength(4);
  });

  it("drops one malformed provider quote without hiding valid alternatives", async () => {
    stubQuotes((quote) => { if (quote.tool === "nordstern") quote.estimate.fromAmount = "2000000"; });
    const result = await getSwapQuotes(input);
    expect(result.quotes).toHaveLength(3);
    expect(result.quotes.some((quote) => quote.provider === "nordstern")).toBe(false);
  });

  it.each([
    ["a different input amount", (quote: ReturnType<typeof providerQuote>) => { quote.estimate.fromAmount = "2000000"; }],
    ["zero output", (quote: ReturnType<typeof providerQuote>) => { quote.estimate.toAmount = "0"; }],
    ["minimum greater than output", (quote: ReturnType<typeof providerQuote>) => { quote.estimate.toAmountMin = "400000000000000"; }],
    ["invalid approval spender", (quote: ReturnType<typeof providerQuote>) => { quote.estimate.approvalAddress = "not-an-address"; }]
  ])("rejects %s", async (_label, mutate) => {
    stubQuotes(mutate);
    await expect(getSwapQuotes(input)).rejects.toThrow();
  });
});
