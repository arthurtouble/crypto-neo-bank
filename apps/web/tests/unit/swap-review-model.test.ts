import { describe, expect, it } from "vitest";
import { marketPriceText, priceDifferenceText, rateText } from "@/lib/swap/review-model";

const usdc = { id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 };
const apple = { id: "8453:0xb200000000000000000000c2e324d24d7eecd1fb", symbol: "AAPLc", decimals: 8 };
const eth = { id: "8453:native", symbol: "ETH", decimals: 18 };

describe("Swap quote lines", () => {
  it("prices a stock in cash whichever way it is swapped, and otherwise per unit paid", () => {
    // 683.02 USDC for 2 AAPLc, and back.
    expect(rateText(usdc, apple, "683020000", "200000000")).toBe("1 AAPLc = 341.51 USDC");
    expect(rateText(apple, usdc, "200000000", "683020000")).toBe("1 AAPLc = 341.51 USDC");
    expect(rateText(eth, usdc, "1000000000000000000", "2500000000")).toBe("1 ETH = 2,500 USDC");
    expect(rateText(usdc, apple, "0", "200000000")).toBe("Unavailable");
  });

  it("keeps the price difference apart from the fees charged, and leaves it out when there is none or no dollar values", () => {
    expect(priceDifferenceText({ fromAmountUsd: "100.00", toAmountUsd: "99.50", providerFeeUsd: 0.25 })).toBe("About $0.25 (0.25%)");
    expect(priceDifferenceText({ fromAmountUsd: "100.00", toAmountUsd: "99.50", providerFeeUsd: null })).toBe("About $0.50 (0.50%)");
    expect(priceDifferenceText({ fromAmountUsd: "100.00", toAmountUsd: "99.75", providerFeeUsd: 0.25 })).toBeNull();
    expect(priceDifferenceText({ fromAmountUsd: "2.00", toAmountUsd: "2.01", providerFeeUsd: null })).toBeNull();
    expect(priceDifferenceText({ fromAmountUsd: null, toAmountUsd: null, providerFeeUsd: 0.5 })).toBeNull();
  });

  it("names the market price with the time it is from", () => {
    expect(marketPriceText("AAPLc", "341.512", "Fri 4:00 PM")).toBe("Market price: 1 AAPLc = $341.51, as of Fri 4:00 PM.");
  });
});
