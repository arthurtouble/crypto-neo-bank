import { describe, expect, it } from "vitest";
import { marketSwapAssetId, parseSwapDeepLink } from "@/lib/markets/swap-links";

describe("canonical Market to Swap links", () => {
  it("maps reviewed Kraken market IDs, not matching symbols", () => {
    expect(marketSwapAssetId({ id: "eth-usd", symbol: "eth" })).toBe("8453:native");
    expect(marketSwapAssetId({ id: "usdc-usd", symbol: "usdc" })).toBe("8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    // LINK isn't a registered asset, so it has no Swap link.
    expect(marketSwapAssetId({ id: "link-usd", symbol: "link" })).toBeNull();
    expect(marketSwapAssetId({ id: "unknown-usd", symbol: "eth" })).toBeNull();
    expect(marketSwapAssetId({ id: "eth-usd", symbol: "scam" })).toBeNull();
    expect(marketSwapAssetId({ id: "btc-usd", symbol: "btc" })).toBeNull();
  });

  it("rejects malformed, unsupported, and identical deep-link assets", () => {
    expect(parseSwapDeepLink({ to: "8453:native" })).toEqual({ fromAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", toAssetId: "8453:native" });
    expect(parseSwapDeepLink({ from: "8453:native", to: "8453:native" })).toEqual({ fromAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", toAssetId: "8453:native" });
    expect(parseSwapDeepLink({ to: "javascript:alert(1)" })).toEqual({ fromAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", toAssetId: "8453:native" });
    expect(parseSwapDeepLink({ to: "56:native" })).toEqual({ fromAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", toAssetId: "8453:native" });
  });
});
