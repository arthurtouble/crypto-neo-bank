import { describe, expect, it } from "vitest";
import { assetNetwork, heldFirst, optionLabel } from "@/lib/swap/picker-model";
import type { CatalogAsset } from "@/lib/swap/assets";

const asset = (chainId: number, address: string, symbol: string, name: string, decimals = 6): CatalogAsset =>
  ({ id: `${chainId}:${address}`, chainId, address, symbol, name, decimals, logoUrl: null, eligibility: "eligible" });
const usdc = asset(8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC", "USD Coin");
const apple = asset(8453, "0xb200000000000000000000c2e324d24d7eecd1fb", "AAPLc", "Apple", 8);
const arbUsdc = asset(42161, "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "USDC", "USD Coin");

describe("Swap asset dropdown", () => {
  it("names the asset, the network when it isn't Base, and what the account holds", () => {
    expect(assetNetwork(1)).toBe("Ethereum");
    expect(optionLabel(usdc)).toBe("USDC · USD Coin");
    expect(optionLabel(arbUsdc)).toBe("USDC · USD Coin on Arbitrum");
    expect(optionLabel(usdc, "50000000")).toBe("USDC · USD Coin · 50 available");
    expect(optionLabel(usdc, null)).toBe("USDC · USD Coin · balance unavailable");
    expect(optionLabel({ ...apple, eligibility: "unavailable" })).toBe("AAPLc · Apple · paused");
  });

  it("puts what the account holds first on the side that pays", () => {
    expect(heldFirst([usdc, apple, arbUsdc], new Map([[apple.id, "100"], [usdc.id, "0"]])).map((item) => item.symbol)).toEqual(["AAPLc", "USDC", "USDC"]);
  });
});
