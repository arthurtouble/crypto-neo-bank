import { describe, expect, it } from "vitest";
import { alertRuleLabel, alertStateLabel, validAlertThreshold } from "@/lib/swap/price-alert-view-model";

describe("price alert presentation", () => {
  it("labels saved rules without implying live monitoring", () => {
    expect(alertStateLabel("active")).toBe("Saved · Not monitoring");
    expect(alertStateLabel("paused")).toBe("Paused");
    expect(alertRuleLabel("above", "2500")).toBe("ETH above $2,500");
    expect(alertRuleLabel("below", "0.000001")).toBe("ETH below $0.000001");
  });

  it("accepts only positive decimal thresholds supported by the API", () => {
    expect(validAlertThreshold("2500.50")).toBe(true);
    expect(validAlertThreshold("0.000001")).toBe(true);
    for (const value of ["", "0", "0.000", "-5", "1e4", "1,000", "01", "1.1234567890123456789"])
      expect(validAlertThreshold(value)).toBe(false);
  });
});
