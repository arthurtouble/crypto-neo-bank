import { describe, expect, it } from "vitest";
import { activityCategory, activityCsv, activityEventLabel, activityLabel, activityStatus, taxSupportCsv } from "@/lib/activity/presentation";

describe("activity presentation", () => {
  it("uses familiar customer-facing labels", () => {
    expect(activityLabel("transfer")).toBe("Sent");
    expect(activityLabel("earn_supply")).toBe("Added to Earn");
    expect(activityStatus("submitted")).toBe("Pending");
    expect(activityCategory("bridge")).toBe("Swaps");
    expect(activityEventLabel("intent_confirmed")).toBe("Confirmed on network");
  });

  it("creates an escaped audit CSV", () => {
    const output = activityCsv([{ createdAt: "2026-09-22", label: "Sent, once", category: "Transfers", status: "Completed", amount: "12", asset: "USDC", destination: "=HYPERLINK(\"bad\")" }]);
    expect(output).toContain('"Sent, once"');
    expect(output).toContain('"\'=HYPERLINK(""bad"")"');
    expect(output.split("\n")).toHaveLength(2);
    expect(output).toContain("Current displayed activity page; Aurel intents capped at latest 50; not complete historical or tax coverage");
  });

  it("keeps tax support evidence explicit without inventing cost basis", () => {
    const output = taxSupportCsv([{ createdAt: "2026-09-22", label: "Added to Earn", category: "Earn", status: "Completed", amount: "12", asset: "USDC", source: "Aave V3", authority: "Aave Protocol API and Base" }]);
    expect(output).toContain('"Review required"');
    expect(output).toContain('"Unavailable"');
    expect(output).toContain('"Aave Protocol API and Base"');
    expect(output).toContain("Current displayed activity page; Aurel intents capped at latest 50; not complete historical or tax coverage");
  });
});
