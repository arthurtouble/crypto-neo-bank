import { describe, expect, it } from "vitest";
import { swapQuoteRequestSchema } from "@/lib/swap/lifi";

describe("swap quote input", () => {
  const address = "0x000000000000000000000000000000000000dEaD";

  it("accepts a curated pair and decimal amount", () => {
    expect(swapQuoteRequestSchema.parse({ fromAssetId: "USDC", toAssetId: "ETH", amount: "250.50", fromAddress: address })).toMatchObject({ fromAssetId: "USDC", toAssetId: "ETH" });
  });

  it("rejects identical, unknown, or over-precision assets", () => {
    expect(() => swapQuoteRequestSchema.parse({ fromAssetId: "USDC", toAssetId: "USDC", amount: "1", fromAddress: address })).toThrow();
    expect(() => swapQuoteRequestSchema.parse({ fromAssetId: "SCAM", toAssetId: "ETH", amount: "1", fromAddress: address })).toThrow();
    expect(() => swapQuoteRequestSchema.parse({ fromAssetId: "USDC", toAssetId: "ETH", amount: "1.1234567890123456789", fromAddress: address })).toThrow();
  });
});
