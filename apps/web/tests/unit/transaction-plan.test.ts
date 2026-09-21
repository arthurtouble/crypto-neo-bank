import { describe, expect, it } from "vitest";
import { collectUnsignedTransactions, collectWarnings, findStringField } from "@/lib/transactions/plan";

describe("unsigned protocol plans", () => {
  it("keeps approval before the original action and rejects another chain", () => {
    const plan = { approval: { to: "0x1111111111111111111111111111111111111111", data: "0x01", chainId: 8453 }, originalTransaction: { to: "0x2222222222222222222222222222222222222222", data: "0x02", chainId: 8453 }, unrelated: { to: "0x3333333333333333333333333333333333333333", chainId: 1 } };
    expect(collectUnsignedTransactions(plan, 8453).map((item) => item.to)).toEqual(["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"]);
  });

  it("extracts nested simulation evidence", () => {
    const preview = { data: { healthFactorBefore: "2.10", healthFactorAfter: "1.62", warnings: [{ message: "Liquidation buffer is narrower." }] } };
    expect(findStringField(preview, ["healthFactorAfter"])).toBe("1.62");
    expect(collectWarnings(preview)).toContain("Liquidation buffer is narrower.");
  });
});

