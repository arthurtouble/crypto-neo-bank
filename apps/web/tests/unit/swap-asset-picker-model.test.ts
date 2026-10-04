import { describe, expect, it } from "vitest";
import { assetNetwork, groupAssets, heldFirst, optionLabel } from "@/lib/swap/picker-model";
import type { CatalogAsset } from "@/lib/swap/assets";

const asset = (chainId: number, address: string, symbol: string, name: string, decimals = 6): CatalogAsset =>
  ({ id: `${chainId}:${address}`, chainId, address, symbol, name, decimals, logoUrl: null, eligibility: "eligible" });
const usdc = asset(8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC", "USD Coin");
const apple = asset(8453, "0xb200000000000000000000c2e324d24d7eecd1fb", "AAPLc", "Apple", 8);
const arbUsdc = asset(42161, "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "USDC", "USD Coin");

describe("Swap asset dropdown", () => {
  it("names the asset as the Overview does, the network when it isn't Base, and what the account holds", () => {
    expect(assetNetwork(1)).toBe("Ethereum");
    expect(optionLabel(usdc)).toBe("USD Coin · USDC");
    expect(optionLabel(apple)).toBe("Apple · AAPLc");
    expect(optionLabel(arbUsdc)).toBe("USD Coin · USDC on Arbitrum");
    expect(optionLabel(usdc, "50000000")).toBe("USD Coin · USDC · 50 available");
    expect(optionLabel(usdc, null)).toBe("USD Coin · USDC · balance unavailable");
    expect(optionLabel({ ...apple, eligibility: "unavailable" })).toBe("Apple · AAPLc · paused");
    expect(optionLabel(apple, undefined, true)).toBe("Apple · AAPLc · not available where you are");
  });

  it("groups the list like the Overview, keeping the order within each group and leaving out empty groups", () => {
    const eth = asset(8453, "native", "ETH", "Ether", 18);
    expect(groupAssets([apple, usdc, eth, arbUsdc]).map((group) => [group.label, group.assets.map((item) => item.name)]))
      .toEqual([["Cash", ["USD Coin", "USD Coin"]], ["Crypto", ["Ether"]], ["Stocks", ["Apple"]]]);
  });

  it("puts what the account holds first on the side that pays", () => {
    expect(heldFirst([usdc, apple, arbUsdc], new Map([[apple.id, "100"], [usdc.id, "0"]])).map((item) => item.symbol)).toEqual(["AAPLc", "USDC", "USDC"]);
  });
});
