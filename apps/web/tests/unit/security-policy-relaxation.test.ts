import { describe, expect, it } from "vitest";
import { policyRelaxationReasons } from "@/lib/security/policy-changes";

const current = {
  accountLocked: false,
  enforceAddressBook: false,
  dailyLimitUsd: 25_000,
  newAddressThresholdUsd: 1_000,
  newAddressDelaySeconds: 86_400,
  stepUpThresholdUsd: 10_000
};

describe("security policy relaxation", () => {
  it("allows unchanged and stricter controls", () => {
    expect(policyRelaxationReasons(current, current)).toEqual([]);
    expect(policyRelaxationReasons(current, { ...current, accountLocked: true, enforceAddressBook: true,
      dailyLimitUsd: 10_000, newAddressThresholdUsd: 500, newAddressDelaySeconds: 172_800,
      stepUpThresholdUsd: 5_000 })).toEqual([]);
  });

  it.each([
    ["accountLocked", { ...current, accountLocked: true }, current],
    ["enforceAddressBook", { ...current, enforceAddressBook: true }, current],
    ["dailyLimitUsd", current, { ...current, dailyLimitUsd: 30_000 }],
    ["newAddressThresholdUsd", current, { ...current, newAddressThresholdUsd: 2_000 }],
    ["newAddressDelaySeconds", current, { ...current, newAddressDelaySeconds: 0 }],
    ["stepUpThresholdUsd", { ...current, stepUpThresholdUsd: 5_000 }, current]
  ] as const)("detects relaxation of %s", (field, before, after) => {
    expect(policyRelaxationReasons(before, after)).toContain(field);
  });

  it("fails closed if a persisted policy value is malformed", () => {
    expect(policyRelaxationReasons({ ...current, dailyLimitUsd: Number.NaN }, current)).toContain("invalid_current_policy");
    expect(policyRelaxationReasons(current, { ...current, newAddressDelaySeconds: -1 })).toContain("invalid_new_policy");
  });
});
