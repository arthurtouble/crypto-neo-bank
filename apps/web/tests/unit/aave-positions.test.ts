import { describe, expect, it } from "vitest";
import { normalizeAaveBaseActivity } from "@/lib/defi/aave";

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
