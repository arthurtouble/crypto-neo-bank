import { describe, expect, it } from "vitest";
import { buildInsights, insightCategory, insightDirection, insightUsd } from "@/lib/insights/presentation";

describe("activity insights", () => {
  it("uses only completed activity in the selected period", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    const result = buildInsights([
      { type: "transfer", status: "confirmed", amount: "125.50", asset: "USDC", createdAt: "2026-09-20T12:00:00Z" },
      { type: "borrow", status: "confirmed", estimatedUsd: 80, createdAt: "2026-09-21T12:00:00Z" },
      { type: "repay", status: "pending", estimatedUsd: 50, createdAt: "2026-09-21T12:00:00Z" },
      { type: "transfer", status: "confirmed", estimatedUsd: 200, createdAt: "2026-07-01T12:00:00Z" }
    ], now, 30);
    expect(result.completedCount).toBe(2);
    expect(result.totals.outgoing).toBe(125.5);
    expect(result.totals.incoming).toBe(80);
  });

  it("does not guess a dollar value for volatile assets", () => {
    expect(insightUsd({ type: "transfer", status: "confirmed", amount: "1", asset: "ETH", createdAt: "2026-09-22T00:00:00Z" })).toBeNull();
    expect(insightUsd({ type: "transfer", status: "confirmed", amount: "42.25", asset: "USDC", createdAt: "2026-09-22T00:00:00Z" })).toBe(42.25);
  });

  it("keeps transfers, allocations, and swaps semantically separate", () => {
    expect(insightDirection("earn_supply")).toBe("allocation");
    expect(insightDirection("bridge_route")).toBe("movement");
    expect(insightCategory("repay")).toBe("Debt Payments");
  });
});

