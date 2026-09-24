import { describe, expect, it, vi } from "vitest";
import { CURATED_SWAP_ASSETS, curatedSwapAsset } from "@/lib/swap/curated-assets";
import { CuratedQuoteError, getCuratedLifiQuote } from "@/lib/swap/curated-quote";

const wallet = "0x0000000000000000000000000000000000000001";
const input = { fromAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", toAssetId: "8453:0x4200000000000000000000000000000000000006", amount: "1", walletAddress: wallet, slippageBps: 50 };

describe("curated LI.FI swaps", () => {
  it("only exposes reviewed asset identities", () => {
    expect(CURATED_SWAP_ASSETS).toHaveLength(11);
    expect(curatedSwapAsset("8453:0xdeadbeef00000000000000000000000000000000")).toBeUndefined();
  });

  it("rejects a non-curated token before calling LI.FI", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(getCuratedLifiQuote({ ...input, toAssetId: "8453:0xdeadbeef00000000000000000000000000000000" }, fetcher)).rejects.toBeInstanceOf(CuratedQuoteError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requests a LI.FI quote without a router allowlist", async () => {
    const quote = { id: "quote-1", action: { fromChainId: 8453, toChainId: 8453,
      fromToken: { chainId: 8453, address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
      toToken: { chainId: 8453, address: "0x4200000000000000000000000000000000000006" },
      fromAddress: wallet, toAddress: wallet, fromAmount: "1000000" }, estimate: { toAmount: "1" }, transactionRequest: { to: wallet, data: "0x", value: "0" } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(quote));
    await expect(getCuratedLifiQuote(input, fetcher)).resolves.toEqual(quote);
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.searchParams.get("fromAmount")).toBe("1000000");
    expect(url.searchParams.getAll("allowExchanges")).toHaveLength(0);
    expect(url.searchParams.getAll("allowBridges")).toHaveLength(0);
  });

  it("rejects a provider quote that changes the recipient", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "x", action: { fromAmount: "1000000", fromAddress: wallet,
      toAddress: "0x0000000000000000000000000000000000000002",
      fromToken: { chainId: 8453, address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
      toToken: { chainId: 8453, address: "0x4200000000000000000000000000000000000006" } }, estimate: {}, transactionRequest: {} }));
    await expect(getCuratedLifiQuote(input, fetcher)).rejects.toMatchObject({ code: "invalid_quote" });
  });

  it("does not tell customers a rate limit is an unavailable route", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(getCuratedLifiQuote(input, fetcher)).rejects.toMatchObject({ code: "provider_unavailable" });
  });
});
