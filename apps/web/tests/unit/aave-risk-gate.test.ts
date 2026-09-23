import { describe, expect, it } from "vitest";
import { assessAaveActionRisk } from "@/lib/defi/aave-risk-gate";

const nowMs = Date.parse("2026-09-23T14:00:00.000Z");
const base = {
  action: "borrow" as const,
  amountRaw: 1_000_000n,
  nowMs,
  maxAgeMs: 30_000,
  minHealthFactorWad: 1_250_000_000_000_000_000n,
  snapshot: { blockNumber: 42_000_000n, blockHash: `0x${"a".repeat(64)}`, observedAtMs: nowMs - 2_000, complete: true },
  reserve: {
    decimals: 6, priceBase: 100_000_000n, liquidationThresholdBps: 8_000,
    active: true, paused: false, frozen: false, borrowingEnabled: true,
    collateralEnabledForUser: true, availableLiquidityRaw: 1_000_000_000n,
    supplyCapRemainingRaw: 1_000_000_000n, borrowCapRemainingRaw: 1_000_000_000n
  },
  account: {
    weightedCollateralBase: 16_000_000_000n, debtBase: 10_000_000_000n,
    assetCollateralBalanceRaw: 200_000_000n, assetDebtRaw: 100_000_000n,
    eModeCategory: 0, isolationMode: false
  }
};

describe("disconnected Aave risk gate", () => {
  it("calculates post-action health from exact raw amount and oracle price", () => {
    const result = assessAaveActionRisk(base);
    expect(result).toMatchObject({ valueBase: 100_000_000n, postDebtBase: 10_100_000_000n, postWeightedCollateralBase: 16_000_000_000n });
    expect(result.postHealthFactorWad).toBeGreaterThan(1_250_000_000_000_000_000n);
  });

  it("rejects stale or incomplete block-bound coverage", () => {
    expect(() => assessAaveActionRisk({ ...base, snapshot: { ...base.snapshot, complete: false } })).toThrow();
    expect(() => assessAaveActionRisk({ ...base, snapshot: { ...base.snapshot, observedAtMs: nowMs - 30_001 } })).toThrow();
    expect(() => assessAaveActionRisk({ ...base, snapshot: { ...base.snapshot, blockHash: "0x1234" } })).toThrow();
    expect(() => assessAaveActionRisk({ ...base, reserve: { ...base.reserve, priceBase: 0n } })).toThrow();
    expect(() => assessAaveActionRisk({ ...base, account: { ...base.account, debtBase: undefined as unknown as bigint } })).toThrow();
  });

  it("blocks all actions on a paused reserve and only supply/borrow on a frozen reserve", () => {
    for (const action of ["supply", "withdraw", "borrow", "repay"] as const)
      expect(() => assessAaveActionRisk({ ...base, action, reserve: { ...base.reserve, paused: true } })).toThrow();
    for (const action of ["supply", "borrow"] as const)
      expect(() => assessAaveActionRisk({ ...base, action, reserve: { ...base.reserve, frozen: true } })).toThrow();
    expect(assessAaveActionRisk({ ...base, action: "repay", reserve: { ...base.reserve, frozen: true } }).postDebtBase).toBe(9_900_000_000n);
    expect(assessAaveActionRisk({ ...base, action: "withdraw", reserve: { ...base.reserve, frozen: true } }).postWeightedCollateralBase).toBe(15_920_000_000n);
  });

  it("blocks an action that leaves debt below the Aurel health floor", () => {
    expect(() => assessAaveActionRisk({ ...base, amountRaw: 30_000_000n })).toThrow(/health/i);
    expect(() => assessAaveActionRisk({ ...base, action: "withdraw", amountRaw: 80_000_000n })).toThrow(/health/i);
    expect(() => assessAaveActionRisk({ ...base, minHealthFactorWad: 1_000_000_000_000_000_000n })).toThrow();
  });

  it("allows debt-free full withdrawal without interpreting a zero health factor as liquidation risk", () => {
    const result = assessAaveActionRisk({ ...base, action: "withdraw", amountRaw: 200_000_000n,
      account: { ...base.account, weightedCollateralBase: 16_000_000_000n, debtBase: 0n, assetDebtRaw: 0n } });
    expect(result).toMatchObject({ postDebtBase: 0n, postWeightedCollateralBase: 0n, postHealthFactorWad: null });
  });

  it("rejects reserve caps, insufficient liquidity, unsupported position modes, and impossible balances", () => {
    expect(() => assessAaveActionRisk({ ...base, action: "supply", reserve: { ...base.reserve, supplyCapRemainingRaw: 999_999n } })).toThrow();
    expect(() => assessAaveActionRisk({ ...base, reserve: { ...base.reserve, borrowCapRemainingRaw: 999_999n } })).toThrow();
    expect(() => assessAaveActionRisk({ ...base, reserve: { ...base.reserve, availableLiquidityRaw: 999_999n } })).toThrow();
    expect(() => assessAaveActionRisk({ ...base, account: { ...base.account, eModeCategory: 1 } })).toThrow();
    expect(() => assessAaveActionRisk({ ...base, account: { ...base.account, isolationMode: true } })).toThrow();
    expect(() => assessAaveActionRisk({ ...base, action: "withdraw", amountRaw: 201_000_000n })).toThrow();
    expect(() => assessAaveActionRisk({ ...base, action: "repay", amountRaw: 101_000_000n })).toThrow();
  });

  it("fails closed when any action-critical reserve flag is missing", () => {
    for (const field of ["active", "paused", "frozen", "borrowingEnabled", "collateralEnabledForUser"] as const)
      expect(() => assessAaveActionRisk({ ...base, reserve: { ...base.reserve, [field]: undefined } })).toThrow();
    expect(() => assessAaveActionRisk({ ...base, snapshot: { ...base.snapshot, blockHash: `0x${"0".repeat(64)}` } })).toThrow();
  });

  it("does not credit newly supplied collateral unless it is already enabled", () => {
    const result = assessAaveActionRisk({ ...base, action: "supply", reserve: { ...base.reserve, collateralEnabledForUser: false } });
    expect(result.postWeightedCollateralBase).toBe(base.account.weightedCollateralBase);
  });

  it("rounds debt increases and collateral reductions against the customer", () => {
    const tiny = { ...base, reserve: { ...base.reserve, decimals: 0, priceBase: 3n, liquidationThresholdBps: 5_000 }, amountRaw: 1n,
      account: { ...base.account, weightedCollateralBase: 10n, debtBase: 1n, assetCollateralBalanceRaw: 1n } };
    expect(assessAaveActionRisk({ ...tiny, action: "borrow" }).postDebtBase).toBe(4n);
    expect(assessAaveActionRisk({ ...tiny, action: "withdraw" }).postWeightedCollateralBase).toBe(8n);
  });
});
