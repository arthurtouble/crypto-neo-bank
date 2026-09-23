import { describe, expect, it } from "vitest";
import { reviewableReminder, reminderDisabledText, reminderAssetLabel } from "@/lib/swap/reminder-view-model";

describe("Swap reminder presentation", () => {
  it("shows recognizable assets without exposing internal chain IDs", () => {
    expect(reminderAssetLabel("8453:native")).toBe("ETH · Base");
    expect(reminderAssetLabel("8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC")).toBe("USDC · Base");
    expect(reminderAssetLabel("8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toBe("0x8335…2913 · Base");
  });
  const due = { occurrenceId: "o", fromAssetId: "8453:native", toAssetId: "1:native", amount: "0.1", canReview: true, disabledReason: null };
  it("copies only saved pair and amount for a fresh customer-initiated review", () => {
    expect(reviewableReminder(due)).toEqual({ fromAssetId: due.fromAssetId, toAssetId: due.toAssetId, amount: due.amount });
  });
  it("does not open review when current eligibility is disabled", () => {
    expect(reviewableReminder({ ...due, canReview: false, disabledReason: "cross_chain_unavailable" })).toBeNull();
    expect(reminderDisabledText("cross_chain_unavailable")).toMatch(/across networks/i);
    expect(reminderDisabledText("account_locked")).toMatch(/locked/i);
    expect(reminderDisabledText("asset_unavailable")).toMatch(/available/i);
  });
});
