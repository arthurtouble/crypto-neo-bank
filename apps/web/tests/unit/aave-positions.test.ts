import { describe, expect, it } from "vitest";
import { normalizeAavePosition } from "@/lib/defi/aave";

describe("Aave position normalization", () => {
  it("normalizes empty protocol data without inventing balances", () => {
    const result = normalizeAavePosition({ data: { v3: { supplies: [], borrows: [] } } }, { data: { v3: { marketsWithPosition: 0, markets: [] } } });
    expect(result).toMatchObject({ marketsWithPosition: 0, supplyGroups: 0, borrowGroups: 0, rewardsStatus: "not_reported" });
    expect(result.netWorthUsd).toBeUndefined();
  });

  it("uses source-reported portfolio metrics", () => {
    const result = normalizeAavePosition({ data: { v3: { supplies: [{ market: "base" }], borrows: [{ market: "base" }] } } }, { data: { v3: { marketsWithPosition: 1, markets: [{ healthFactor: "2.41", netWorthUSD: "1250.50" }] } } });
    expect(result.healthFactor).toBe("2.41");
    expect(result.netWorthUsd).toBe("1250.50");
    expect(result.supplyGroups).toBe(1);
    expect(result.borrowGroups).toBe(1);
  });
});

