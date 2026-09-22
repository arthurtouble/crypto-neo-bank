import { describe, expect, it } from "vitest";
import { makeSwapReviewKey, quoteIsFresh, displayRawAmount } from "@/lib/swap/review-model";

describe("Swap review state", () => {
  const baseline = { fromAssetId: "8453:native", toAssetId: "1:native", amount: "1.2", walletAddress: "0x000000000000000000000000000000000000dEaD", slippageBps: 50 };

  it("invalidates a quote on any review-defining change", () => {
    const key = makeSwapReviewKey(baseline);
    for (const change of [
      { amount: "1.3" }, { fromAssetId: "1:native" }, { toAssetId: "8453:native" },
      { walletAddress: "0x0000000000000000000000000000000000000001" }, { slippageBps: 100 }
    ]) expect(makeSwapReviewKey({ ...baseline, ...change })).not.toBe(key);
    expect(makeSwapReviewKey({ ...baseline, walletAddress: baseline.walletAddress.toLowerCase() })).toBe(key);
  });

  it("refuses stale or malformed quote expiry", () => {
    const now = Date.parse("2026-09-22T12:00:00.000Z");
    expect(quoteIsFresh("2026-09-22T12:00:05.000Z", now)).toBe(true);
    expect(quoteIsFresh("2026-09-22T12:00:00.000Z", now)).toBe(false);
    expect(quoteIsFresh("not-a-date", now)).toBe(false);
  });

  it("keeps raw amount display exact without floating-point conversion", () => {
    expect(displayRawAmount("123456789123456789", 18)).toBe("0.123456789123456789");
    expect(displayRawAmount("123456789", 6)).toBe("123.456789");
  });
});
