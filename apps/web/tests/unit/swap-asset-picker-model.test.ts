import { describe, expect, it } from "vitest";
import { assetCaption, assetNetwork, contractHint } from "@/lib/swap/picker-model";
import type { CatalogAsset } from "@/lib/swap/assets";

const asset: CatalogAsset = { id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453,
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin", decimals: 6,
  logoUrl: null, eligibility: "eligible" };

describe("Swap asset picker presentation", () => {
  it("keeps chain identity available but secondary to the asset", () => {
    expect(assetNetwork(8453)).toBe("Base");
    expect(assetNetwork(1)).toBe("Ethereum");
    expect(assetCaption(asset)).toBe("USD Coin · Base");
    expect(contractHint(asset)).toBe("0x8335…2913");
    expect(contractHint({ ...asset, address: null, id: "8453:native" })).toBe("Native asset");
  });

});
