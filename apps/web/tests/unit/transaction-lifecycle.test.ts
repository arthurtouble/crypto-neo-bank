import { describe, expect, it } from "vitest";
import { lifecycleCopy, lifecycleStep, normalizeIntentStatus, normalizeVerifiedIntentStatus, terminalIntentStatuses } from "@/lib/transactions/lifecycle";

describe("transaction lifecycle presentation", () => {
  it("maps authoritative intent states without upgrading pending work", () => {
    expect(normalizeIntentStatus("submitted")).toBe("submitted");
    expect(normalizeIntentStatus("confirmed")).toBe("confirmed");
    expect(normalizeIntentStatus("blocked")).toBe("failed");
    expect(normalizeIntentStatus("reviewed")).toBeNull();
  });

  it("never presents a historical receipt-only row as independently confirmed", () => {
    expect(normalizeVerifiedIntentStatus("confirmed", "unverified_legacy")).toBe("submitted");
    expect(normalizeVerifiedIntentStatus("confirmed", "pending")).toBe("submitted");
    expect(normalizeVerifiedIntentStatus("confirmed", "confirmed")).toBe("confirmed");
  });

  it("keeps progress ordered and names actions in familiar language", () => {
    expect(lifecycleStep("awaiting_confirmation")).toBe(1);
    expect(lifecycleStep("submitted")).toBe(2);
    expect(lifecycleCopy("confirmed", "Withdrawal").title).toBe("Withdrawal complete");
    expect(lifecycleCopy("cancelled", "Transfer").detail).toContain("Nothing else");
  });

  it("only treats terminal provider or chain states as terminal", () => {
    expect(terminalIntentStatuses.has("confirmed")).toBe(true);
    expect(terminalIntentStatuses.has("submitted")).toBe(false);
  });
});
