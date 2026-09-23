import { describe, expect, it } from "vitest";
import { defaultTransactionPolicy, evaluateTransactionPolicy } from "@/lib/transactions/policy";

const baseIntent = {
  type: "transfer" as const,
  chainId: 8453,
  asset: "USDC",
  amount: "1000",
  destination: "0x1111111111111111111111111111111111111111",
  estimatedUsd: 1000,
  availableUsd: 50_000
};

describe("transaction policy", () => {
  it("always requires customer wallet confirmation", () => {
    expect(evaluateTransactionPolicy(baseIntent, defaultTransactionPolicy, new Date(), "100000").requiresWalletConfirmation).toBe(true);
  });

  it("blocks unsupported chains", () => {
    const decision = evaluateTransactionPolicy({ ...baseIntent, chainId: 999999 }, defaultTransactionPolicy, new Date(), "100000");
    expect(decision.permitted).toBe(false);
    expect(decision.findings.some((item) => item.code === "unsupported_chain")).toBe(true);
  });

  it("enforces an enabled destination allowlist", () => {
    const decision = evaluateTransactionPolicy(baseIntent, { ...defaultTransactionPolicy, enforceAllowlist: true }, new Date(), "100000");
    expect(decision.permitted).toBe(false);
    expect(decision.findings.some((item) => item.code === "destination_not_allowed")).toBe(true);
  });

  it("requires step-up and delays large transfers", () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    const decision = evaluateTransactionPolicy({ ...baseIntent, amount: "30000", estimatedUsd: 30_000 }, defaultTransactionPolicy, now, "3000000");
    expect(decision.requiresStepUp).toBe(true);
    expect(decision.releaseAt).toBe("2026-09-22T12:00:00.000Z");
  });

  it.each([
    [20_000, "999999", false],
    [20_000, "1000000", true],
    [10_000, "1000000", true],
    [5_000, "500000", true]
  ])("enforces the step-up floor with configured threshold %i and trusted cents %s", (stepUpThresholdUsd, trustedCents, expected) => {
    const decision = evaluateTransactionPolicy(
      { ...baseIntent, type: "earn_supply" },
      { ...defaultTransactionPolicy, stepUpThresholdUsd, dailyLimitUsd: 100_000 },
      new Date(), trustedCents
    );
    expect(decision.requiresStepUp).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("fails closed for a nonfinite persisted step-up threshold %s", (stepUpThresholdUsd) => {
    const decision = evaluateTransactionPolicy(
      { ...baseIntent, type: "earn_supply" },
      { ...defaultTransactionPolicy, stepUpThresholdUsd, dailyLimitUsd: 100_000 },
      new Date(), "100000"
    );
    expect(decision.requiresStepUp).toBe(true);
  });

  it("warns without blocking when a reserve target would be crossed", () => {
    const decision = evaluateTransactionPolicy({ ...baseIntent, type: "earn_supply", estimatedUsd: 45_000 }, { ...defaultTransactionPolicy, dailyLimitUsd: 100_000 });
    expect(decision.permitted).toBe(false);
    expect(decision.findings.some((item) => item.code === "value_unavailable")).toBe(true);
  });

  it("blocks every outgoing intent while the account is locked", () => {
    const decision = evaluateTransactionPolicy(baseIntent, { ...defaultTransactionPolicy, accountLocked: true }, new Date(), "100000");
    expect(decision.permitted).toBe(false);
    expect(decision.findings.some((item) => item.code === "account_locked")).toBe(true);
  });

  it("requires a cooled saved destination above the configured threshold", () => {
    const decision = evaluateTransactionPolicy(baseIntent, { ...defaultTransactionPolicy, newAddressThresholdUsd: 500 }, new Date(), "100000");
    expect(decision.permitted).toBe(false);
    expect(decision.findings.some((item) => item.code === "new_destination_threshold")).toBe(true);
  });

  it("blocks an intent that exceeds the rolling daily limit", () => {
    const decision = evaluateTransactionPolicy(baseIntent, { ...defaultTransactionPolicy, spentTodayUsd: 24_500, dailyLimitUsd: 25_000, newAddressThresholdUsd: 5_000 }, new Date(), "100000");
    expect(decision.permitted).toBe(false);
    expect(decision.findings.some((item) => item.code === "daily_limit_exceeded")).toBe(true);
  });

  it("never treats browser estimates as trusted value", () => {
    const decision = evaluateTransactionPolicy({ ...baseIntent, amount: "30000", estimatedUsd: 0, availableUsd: 999999 });
    expect(decision.permitted).toBe(false);
    expect(decision.findings.some((item) => item.code === "value_unavailable")).toBe(true);
  });

  it("applies limits, step-up and delay using trusted cents despite a zero browser estimate", () => {
    const decision = evaluateTransactionPolicy({ ...baseIntent, amount: "30000", estimatedUsd: 0 }, { ...defaultTransactionPolicy, dailyLimitUsd: 100_000, newAddressThresholdUsd: 100_000 }, new Date("2026-09-21T12:00:00Z"), "3000000");
    expect(decision.permitted).toBe(true);
    expect(decision.requiresStepUp).toBe(true);
    expect(decision.releaseAt).toBe("2026-09-22T12:00:00.000Z");
  });
});
