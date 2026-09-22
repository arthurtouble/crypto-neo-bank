import { describe, expect, it, vi } from "vitest";
import { createLifiQuoteAdapter } from "@/lib/swap/lifi";
import type { CatalogAsset } from "@/lib/swap/assets";

const wallet = "0x1111111111111111111111111111111111111111";
const approvalTarget = "0x2222222222222222222222222222222222222222";
const routeTarget = "0x3333333333333333333333333333333333333333";
const baseUsdc: CatalogAsset = {
  id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453,
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin",
  decimals: 6, logoUrl: null, verification: "verified", eligibility: "eligible"
};
const baseEth: CatalogAsset = {
  id: "8453:native", chainId: 8453, address: null, symbol: "ETH", name: "Ether",
  decimals: 18, logoUrl: null, verification: "verified", eligibility: "eligible"
};
const mainnetEth: CatalogAsset = { ...baseEth, id: "1:native", chainId: 1 };

type ProviderQuote = ReturnType<typeof lifiQuote>;

function lifiQuote() {
  return {
    id: "quote-1", tool: "1inch",
    action: {
      fromChainId: 8453, toChainId: 8453,
      fromToken: { symbol: "USDC", decimals: 6, chainId: 8453, address: baseUsdc.address! },
      toToken: { symbol: "ETH", decimals: 18, chainId: 8453, address: "0x0000000000000000000000000000000000000000" }
    },
    estimate: {
      fromAmount: "1000000", toAmount: "300000000000000", toAmountMin: "290000000000000",
      approvalAddress: approvalTarget, fromAmountUSD: "1", toAmountUSD: "0.99"
    },
    transactionRequest: { to: routeTarget, data: "0x1234", value: "0", chainId: 8453 },
    expiresAt: undefined as string | undefined
  };
}

function adapter(payload: unknown) {
  return adapterWithFetcher(vi.fn(async () => Response.json(payload)));
}

function adapterWithFetcher(fetcher: typeof fetch) {
  return createLifiQuoteAdapter({
    fetcher,
    now: () => Date.parse("2026-09-22T12:00:00.000Z"),
    policy: {
      allowedTools: new Set(["1inch", "across"]),
      allowedExchanges: new Set(["1inch", "0x"]),
      allowedTargets: new Set([routeTarget.toLowerCase()]),
      allowedApprovalTargets: new Set([approvalTarget.toLowerCase()])
    }
  });
}

describe("provider-neutral LI.FI quotes", () => {
  it("asks LI.FI to choose only from configured audited exchanges", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return Response.json(lifiQuote());
    };
    await adapterWithFetcher(fetcher).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth });

    expect(new URL(requests[0]).searchParams.getAll("allowExchanges")).toEqual(["0x", "1inch"]);
  });

  it("accepts a valid quote response delivered in chunks", async () => {
    const encoded = new TextEncoder().encode(JSON.stringify(lifiQuote()));
    const midpoint = Math.floor(encoded.byteLength / 2);
    const fetcher: typeof fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoded.slice(0, midpoint));
        controller.enqueue(encoded.slice(midpoint));
        controller.close();
      }
    }));

    const quotes = await adapterWithFetcher(fetcher).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth });
    expect(quotes).toHaveLength(1);
  });

  it("cancels an oversized chunked quote response before JSON parsing", async () => {
    let cancelled = false;
    const chunk = new Uint8Array(600_000).fill(32);
    const fetcher: typeof fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      },
      cancel() { cancelled = true; }
    }));

    await expect(adapterWithFetcher(fetcher).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "quote_unavailable" });
    expect(cancelled).toBe(true);
  });

  it("rejects a declared oversized quote response without consuming it", async () => {
    let cancelled = false;
    const fetcher: typeof fetch = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([123])); },
      cancel() { cancelled = true; }
    }), { headers: { "content-length": "1000001" } });

    await expect(adapterWithFetcher(fetcher).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "quote_unavailable" });
    expect(cancelled).toBe(true);
  });

  it("preserves canonical identities and immutable raw amounts for a same-chain route", async () => {
    const [quote] = await adapter(lifiQuote()).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth });

    expect(quote).toMatchObject({
      provider: "lifi:1inch", quoteId: "quote-1", fromAssetId: baseUsdc.id, toAssetId: baseEth.id,
      fromChainId: 8453, toChainId: 8453, fromAmountRaw: "1000000",
      toAmountRaw: "300000000000000", toAmountMinRaw: "290000000000000",
      networkFeeUsd: null, priceImpactPercent: 1, approvalTarget, routeKind: "same_chain"
    });
    expect(quote.planReference).toMatch(/^lifi:quote-1:0x[a-f0-9]{64}$/);
  });

  it("uses the source asset's actual decimals and rejects excessive request precision", async () => {
    await expect(adapter(lifiQuote()).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1.0000001", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "asset_unavailable" });
  });

  it("accepts a validated cross-chain route without exposing an executable request", async () => {
    const payload = lifiQuote();
    payload.tool = "across";
    payload.action.toChainId = 1;
    payload.action.toToken.chainId = 1;
    const [quote] = await adapter(payload).quote({
      fromAssetId: baseUsdc.id, toAssetId: mainnetEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: mainnetEth });
    expect(quote.routeKind).toBe("cross_chain");
    expect(quote).not.toHaveProperty("transactionRequest");
  });

  it.each([
    ["source identity", (quote: ProviderQuote) => { quote.action.fromToken.address = "0x4444444444444444444444444444444444444444"; }],
    ["input amount", (quote: ProviderQuote) => { quote.estimate.fromAmount = "2000000"; }],
    ["source transaction chain", (quote: ProviderQuote) => { quote.transactionRequest.chainId = 1; }],
    ["output", (quote: ProviderQuote) => { quote.estimate.toAmount = "0"; }],
    ["minimum", (quote: ProviderQuote) => { quote.estimate.toAmountMin = "400000000000000"; }],
    ["target", (quote: ProviderQuote) => { quote.transactionRequest.to = "0x4444444444444444444444444444444444444444"; }],
    ["spender", (quote: ProviderQuote) => { quote.estimate.approvalAddress = "0x4444444444444444444444444444444444444444"; }],
    ["value", (quote: ProviderQuote) => { quote.transactionRequest.value = "1"; }],
    ["calldata", (quote: ProviderQuote) => { quote.transactionRequest.data = "0x"; }],
    ["tool", (quote: ProviderQuote) => { quote.tool = "unknown"; }]
  ])("fails closed when LI.FI changes the %s", async (_label, mutate) => {
    const payload = lifiQuote(); mutate(payload);
    await expect(adapter(payload).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects stale and excessive-price-impact routes", async () => {
    const stale = lifiQuote(); stale.expiresAt = "2026-09-22T11:59:59.000Z";
    await expect(adapter(stale).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
    const impact = lifiQuote(); impact.estimate.toAmountUSD = "0.90";
    await expect(adapter(impact).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("withholds an unverified route when price impact is unavailable", async () => {
    const unverified = { ...baseUsdc, verification: "unverified" as const };
    const payload = lifiQuote();
    delete (payload.estimate as Partial<typeof payload.estimate>).fromAmountUSD;
    delete (payload.estimate as Partial<typeof payload.estimate>).toAmountUSD;
    await expect(adapter(payload).quote({ fromAssetId: unverified.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50, unverifiedAcknowledgements: [unverified.id] }, { from: unverified, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("labels missing fee and price observations unavailable for verified assets", async () => {
    const payload = lifiQuote();
    delete (payload.estimate as Partial<typeof payload.estimate>).fromAmountUSD;
    delete (payload.estimate as Partial<typeof payload.estimate>).toAmountUSD;
    const [quote] = await adapter(payload).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth });
    expect(quote).toMatchObject({ networkFeeUsd: null, priceImpactPercent: null });
  });

  it("returns a typed unsupported-chain error at the adapter boundary", async () => {
    const unsupported = { ...baseEth, id: "56:native", chainId: 56 };
    await expect(adapter(lifiQuote()).quote({ fromAssetId: baseUsdc.id, toAssetId: unsupported.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: unsupported })).rejects.toMatchObject({ code: "unsupported_chain" });
  });

  it("binds the immutable plan reference to the owned source wallet", async () => {
    const first = await adapter(lifiQuote()).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth });
    const second = await adapter(lifiQuote()).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: "0x5555555555555555555555555555555555555555", slippageBps: 50 }, { from: baseUsdc, to: baseEth });
    expect(first[0].planReference).not.toBe(second[0].planReference);
  });
});
