import { describe, expect, it } from "vitest";
import { assetId, catalogAssetSchema, parseAssetId, sameAsset } from "@/lib/swap/assets";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("canonical swap asset identity", () => {
  it("collapses valid address casing without conflating chains", () => {
    expect(assetId(8453, BASE_USDC)).toBe("8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(assetId(8453, BASE_USDC.toLowerCase())).toBe("8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(assetId(1, BASE_USDC)).toBe("1:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(sameAsset("8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "1:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toBe(false);
  });

  it("assigns native assets chain-scoped IDs", () => {
    expect(assetId(8453, null)).toBe("8453:native");
    expect(assetId(1, null)).toBe("1:native");
    expect(parseAssetId("8453:native")).toEqual({ chainId: 8453, address: null });
    expect(sameAsset("8453:native", "1:native")).toBe(false);
  });

  it("rejects unsupported chains, malformed addresses, and bad checksums", () => {
    expect(() => assetId(56, BASE_USDC)).toThrow();
    expect(() => assetId(8453, "0x1234")).toThrow();
    expect(() => assetId(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02914")).toThrow();
    expect(() => assetId(0, null)).toThrow();
  });

  it("parses only canonical IDs from URL input", () => {
    expect(parseAssetId("8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toEqual({ chainId: 8453, address: BASE_USDC.toLowerCase() });
    expect(parseAssetId("8453:javascript:alert(1)")).toBeNull();
    expect(parseAssetId(`8453:${BASE_USDC}`)).toBeNull();
    expect(parseAssetId("08453:native")).toBeNull();
    expect(parseAssetId("56:native")).toBeNull();
    expect(parseAssetId("8453:native?from=evil")).toBeNull();
  });

  it("bounds catalog metadata independently from token symbols", () => {
    const asset = { id: assetId(8453, BASE_USDC), chainId: 8453, address: BASE_USDC.toLowerCase(), symbol: "USDC", name: "USD Coin", decimals: 6, logoUrl: null, verification: "verified", eligibility: "eligible" };
    expect(catalogAssetSchema.safeParse(asset).success).toBe(true);
    expect(catalogAssetSchema.safeParse({ ...asset, symbol: "" }).success).toBe(false);
    expect(catalogAssetSchema.safeParse({ ...asset, name: "x".repeat(121) }).success).toBe(false);
    expect(catalogAssetSchema.safeParse({ ...asset, decimals: 37 }).success).toBe(false);
    expect(catalogAssetSchema.safeParse({ ...asset, id: "1:native" }).success).toBe(false);
  });
});
