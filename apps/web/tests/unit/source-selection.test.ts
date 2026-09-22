import { describe, expect, it } from "vitest";
import { selectAutomaticSource } from "@/lib/routing/source-selection";

describe("automatic swap source selection", () => {
  it("chooses the largest eligible balance without using the destination account", () => {
    expect(selectAutomaticSource([
      { chainId: 8453, balance: 500n },
      { chainId: 1, balance: 300n },
      { chainId: 42161, balance: 700n }
    ], 200n, 8453)).toEqual({ chainId: 42161, balance: 700n });
  });

  it("returns null when no eligible account can cover the amount", () => {
    expect(selectAutomaticSource([{ chainId: 1, balance: 99n }], 100n, 8453)).toBeNull();
  });
});
