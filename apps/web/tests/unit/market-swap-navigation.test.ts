import { describe, expect, it } from "vitest";
import * as swapAssetModule from "@/config/swap-assets";

type SwapAssetModule = typeof swapAssetModule & {
  marketSwapAssetId?: (market: { symbol: string; name: string }) => string | null;
  resolveSwapSelection?: (parameters: { from?: string | null; to?: string | null }) => { fromAssetId: string; toAssetId: string };
};

const subject = swapAssetModule as SwapAssetModule;

describe("market to swap navigation", () => {
  it("only makes an exact curated market asset actionable", () => {
    expect(typeof subject.marketSwapAssetId).toBe("function");
    expect(subject.marketSwapAssetId?.({ symbol: "eth", name: "Ethereum" })).toBe("ETH");
    expect(subject.marketSwapAssetId?.({ symbol: "link", name: "Chainlink" })).toBe("LINK");
    expect(subject.marketSwapAssetId?.({ symbol: "btc", name: "Bitcoin" })).toBeNull();
    expect(subject.marketSwapAssetId?.({ symbol: "eth2", name: "Ethereum lookalike" })).toBeNull();
  });

  it("uses a safe distinct pair for a supported market deep link", () => {
    expect(typeof subject.resolveSwapSelection).toBe("function");
    expect(subject.resolveSwapSelection?.({ to: "LINK" })).toEqual({ fromAssetId: "USDC", toAssetId: "LINK" });
    expect(subject.resolveSwapSelection?.({ to: "USDC" })).toEqual({ fromAssetId: "ETH", toAssetId: "USDC" });
  });

  it("ignores unknown, mixed-case, and identical URL selections", () => {
    expect(typeof subject.resolveSwapSelection).toBe("function");
    expect(subject.resolveSwapSelection?.({ from: "SCAM", to: "javascript:alert(1)" })).toEqual({ fromAssetId: "USDC", toAssetId: "ETH" });
    expect(subject.resolveSwapSelection?.({ from: "eth", to: "ETH" })).toEqual({ fromAssetId: "USDC", toAssetId: "ETH" });
    expect(subject.resolveSwapSelection?.({ from: "AAVE", to: "AAVE" })).toEqual({ fromAssetId: "USDC", toAssetId: "AAVE" });
  });
});
