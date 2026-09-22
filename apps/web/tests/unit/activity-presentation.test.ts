import { describe, expect, it } from "vitest";
import { activityCategory, activityCsv, activityLabel, activityStatus } from "@/lib/activity/presentation";

describe("activity presentation", () => {
  it("uses familiar customer-facing labels", () => {
    expect(activityLabel("transfer")).toBe("Sent");
    expect(activityLabel("earn_supply")).toBe("Added to Earn");
    expect(activityStatus("submitted")).toBe("Pending");
    expect(activityCategory("bridge")).toBe("Swaps");
  });

  it("creates an escaped audit CSV", () => {
    const output = activityCsv([{ createdAt: "2026-09-22", label: "Sent, once", category: "Transfers", status: "Completed", amount: "12", asset: "USDC" }]);
    expect(output).toContain('"Sent, once"');
    expect(output.split("\n")).toHaveLength(2);
  });
});
