import { describe, expect, it } from "vitest";
import { selectAutomaticSource } from "@/lib/routing/source-selection";

describe("automatic swap source selection", () => {
  it("chooses the largest eligible balance without using the destination account", () => {
    expect(selectAutomaticSource([
      { chainId: 8453, walletAddress: "0xbase", balance: 500n },
      { chainId: 1, walletAddress: "0xeth", balance: 300n },
      { chainId: 42161, walletAddress: "0xarb", balance: 700n }
    ], 200n, 8453)).toEqual({ chainId: 42161, walletAddress: "0xarb", balance: 700n });
  });

  it("returns null when no eligible account can cover the amount", () => {
    expect(selectAutomaticSource([{ chainId: 1, walletAddress: "0xeth", balance: 99n }], 100n, 8453)).toBeNull();
  });

  it("selects deterministically across connected accounts", () => {
    expect(selectAutomaticSource([
      { chainId: 1, walletAddress: "0xbbb", balance: 500n },
      { chainId: 1, walletAddress: "0xaaa", balance: 500n }
    ], 100n, 8453)?.walletAddress).toBe("0xaaa");
  });
});
