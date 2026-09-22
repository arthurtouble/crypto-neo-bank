import { describe, expect, it } from "vitest";
import { benefitServices, moneyCapabilities, previewMoneyAccount } from "@/lib/providers/service-catalog";

describe("provider-ready service catalog", () => {
  it("keeps bank rails gated until provider setup", () => {
    const account = previewMoneyAccount("Test Member");
    expect(account.state).toBe("setup_required");
    expect(account.accountNumberLastFour).toBeUndefined();
    expect(moneyCapabilities.filter((item) => item.key !== "crypto").every((item) => item.state === "setup_required")).toBe(true);
  });

  it("does not claim uncontracted benefits are active", () => {
    expect(benefitServices.every((item) => item.state !== "available")).toBe(true);
  });
});
