import { describe, expect, it } from "vitest";
import { normalizeAaveBaseActivity, normalizeAaveBaseRewards, normalizeAavePosition } from "@/lib/defi/aave";

describe("Aave position normalization", () => {
  it("normalizes empty protocol data without inventing balances", () => {
    const result = normalizeAavePosition({ data: { v3: { supplies: [], borrows: [] } } }, { data: { v3: { marketsWithPosition: 0, markets: [] } } });
    expect(result).toMatchObject({ marketsWithPosition: 0, supplyGroups: 0, borrowGroups: 0 });
    expect(result.netWorthUsd).toBeUndefined();
  });

  it("rejects incomplete position responses instead of reporting no debt", () => {
    expect(() => normalizeAavePosition({ data: { v3: {} } }, { data: { v3: { markets: [] } } })).toThrow(/incomplete/i);
    expect(() => normalizeAavePosition(null, null)).toThrow(/incomplete/i);
  });

  it("uses only the governed Base market metrics", () => {
    const market = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
    const result = normalizeAavePosition({ data: { v3: { supplies: [{ market }], borrows: [{ market, symbol: "USDC", balance: "20", balanceUsd: "20" }] } } }, { data: { v3: { marketsWithPosition: 1, markets: [{ market, healthFactor: "2.41", netWorthUSD: "1250.50" }] } } });
    expect(result.healthFactor).toBe("2.41");
    expect(result.netWorthUsd).toBe("1250.50");
    expect(result.supplyGroups).toBe(1);
    expect(result.borrowGroups).toBe(1);
  });

  it("does not report another market's debt or health as Base debt", () => {
    const other = "0x1111111111111111111111111111111111111111";
    const result = normalizeAavePosition({ data: { v3: { supplies: [], borrows: [{ market: other, symbol: "USDC", balance: "20", balanceUsd: "20" }] } } },
      { data: { v3: { marketsWithPosition: 1, markets: [{ market: other, healthFactor: "1.01", netWorthUSD: "100" }] } } });
    expect(result).toMatchObject({ marketsWithPosition: 0, supplyGroups: 0, borrowGroups: 0, debts: [] });
    expect(result.healthFactor).toBeUndefined();
    expect(result.netWorthUsd).toBeUndefined();
  });

  it("shows governed Base debt from Aave without treating incomplete rows as zero", () => {
    const positions = { data: { v3: { supplies: [], borrows: [
      { market: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", symbol: "USDC", balance: "24.18", balanceUsd: "24.17" }
    ] } } };
    const summary = { data: { v3: { markets: [] } } };
    expect(normalizeAavePosition(positions, summary).debts).toEqual([{ symbol: "USDC", amount: "24.18", usd: "24.17" }]);
    expect(() => normalizeAavePosition({ data: { v3: { supplies: [], borrows: [{ market: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", symbol: "USDC" }] } } }, summary)).toThrow(/incomplete/i);
  });

  it("normalizes source-reported Base rewards without reading another chain", () => {
    const result = normalizeAaveBaseRewards({ data: { v3: { partial: true, rewards: [
      { chainId: 10, claimable: [{ amount: { amount: { value: "99" }, usd: "99" }, currency: { symbol: "OP", name: "Optimism", address: "0x0000000000000000000000000000000000000001" } }] },
      { chainId: 8453, claimable: [{ amount: { amount: { value: "12.5" }, usd: "4.25" }, currency: { symbol: "WELL", name: "WELL", address: "0x0000000000000000000000000000000000000002" } }], transaction: { to: "0x0000000000000000000000000000000000000003" } }
    ] } } });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ symbol: "WELL", amount: "12.5", usd: "4.25" });
    expect(result.totalUsd).toBe("4.25");
    expect(result.claimAvailable).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.sourceStatus).toBe("available");
  });

  it("keeps missing rewards empty instead of estimating them", () => {
    expect(normalizeAaveBaseRewards({ data: { v3: { rewards: [] } } })).toEqual({ items: [], totalUsd: "0", partial: false, claimAvailable: false, sourceStatus: "none" });
    expect(normalizeAaveBaseRewards(null).sourceStatus).toBe("unavailable");
  });
});

describe("Aave Base activity", () => {
  it("normalizes authoritative protocol records and coverage", () => {
    const result = normalizeAaveBaseActivity({ data: { v3: { partial: true, items: [{ __typename: "UserSupplyTransaction", txHash: `0x${"a".repeat(64)}`, timestamp: "2026-09-22T12:00:00Z", amount: { value: "25" }, assetPriceUSD: "1", reserve: { symbol: "USDC" } }], pageInfo: { next: "opaque" } } } });
    expect(result.items[0]).toMatchObject({ type: "earn_supply", amount: "25", asset: "USDC", estimatedUsd: 25, sourceKind: "chain" });
    expect(result).toMatchObject({ partial: true, nextCursor: "opaque", sourceStatus: "available" });
  });

  it("does not invent malformed activity", () => {
    expect(normalizeAaveBaseActivity({ data: { v3: { items: [{ __typename: "UserBorrowTransaction" }] } } })).toMatchObject({ items: [], sourceStatus: "none" });
    expect(normalizeAaveBaseActivity(null).sourceStatus).toBe("unavailable");
  });
});
