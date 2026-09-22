import { describe, expect, it } from "vitest";
import { allocationIsValid, allocationPreview, allocationTotal } from "@/lib/income/allocation";

describe("income allocation planning", () => {
  const plan = { spendingPercent: 60, goalsPercent: 25, earnPercent: 15 };

  it("requires exact whole-number allocations totaling 100", () => {
    expect(allocationTotal(plan)).toBe(100);
    expect(allocationIsValid(plan)).toBe(true);
    expect(allocationIsValid({ ...plan, earnPercent: 16 })).toBe(false);
    expect(allocationIsValid({ ...plan, goalsPercent: 24.5 })).toBe(false);
  });

  it("previews rather than asserting moved balances", () => {
    expect(allocationPreview(4_000, plan)).toEqual({ spending: 2_400, goals: 1_000, earn: 600 });
    expect(allocationPreview(-1, plan)).toBeNull();
  });
});
