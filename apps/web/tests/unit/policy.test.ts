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
    expect(evaluateTransactionPolicy(baseIntent).requiresWalletConfirmation).toBe(true);
  });

  it("blocks unsupported chains", () => {
    const decision = evaluateTransactionPolicy({ ...baseIntent, chainId: 999999 });
    expect(decision.permitted).toBe(false);
    expect(decision.findings.some((item) => item.code === "unsupported_chain")).toBe(true);
  });

  it("enforces an enabled destination allowlist", () => {
    const decision = evaluateTransactionPolicy(baseIntent, { ...defaultTransactionPolicy, enforceAllowlist: true });
    expect(decision.permitted).toBe(false);
    expect(decision.findings.some((item) => item.code === "destination_not_allowed")).toBe(true);
  });

  it("requires step-up and delays large transfers", () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    const decision = evaluateTransactionPolicy({ ...baseIntent, amount: "30000", estimatedUsd: 30_000 }, defaultTransactionPolicy, now);
    expect(decision.requiresStepUp).toBe(true);
    expect(decision.releaseAt).toBe("2026-09-22T12:00:00.000Z");
  });

  it("warns without blocking when a reserve target would be crossed", () => {
    const decision = evaluateTransactionPolicy({ ...baseIntent, estimatedUsd: 45_000 });
    expect(decision.permitted).toBe(true);
    expect(decision.findings.some((item) => item.code === "reserve_below_target")).toBe(true);
  });
});

