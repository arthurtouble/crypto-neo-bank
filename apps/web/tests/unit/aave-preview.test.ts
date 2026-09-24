import { describe, expect, it, vi } from "vitest";

const snapshot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/defi/aave-risk-snapshot", () => ({ readAaveBaseRiskSnapshot: snapshot }));

import { previewAaveBaseAction } from "@/lib/defi/aave-preview";

const address = "0x2222222222222222222222222222222222222222";
const input = { action: "supply" as const, sender: address, symbol: "USDC" as const, amount: "1.5" };
const now = Date.parse("2026-09-24T12:00:00.000Z");
const baseSnapshot = {
  action: "supply", amountRaw: 1_500_000n, nowMs: now, maxAgeMs: 30_000,
  minHealthFactorWad: 1_250_000_000_000_000_000n,
  snapshot: { blockNumber: 100n, blockHash: `0x${"a".repeat(64)}`, observedAtMs: now - 2_000, complete: true },
  wallet: { balanceRaw: 2_000_000n, poolAllowanceRaw: 1_000_000n },
  reserve: { decimals: 6, priceBase: 100_000_000n, liquidationThresholdBps: 8_000, active: true,
    paused: false, frozen: false, borrowingEnabled: true, collateralEnabledForUser: true,
    availableLiquidityRaw: 100_000_000n, supplyCapRemainingRaw: 100_000_000n, borrowCapRemainingRaw: 100_000_000n },
  account: { weightedCollateralBase: 0n, debtBase: 0n, availableBorrowsBase: 0n,
    assetCollateralBalanceRaw: 0n, variableDebtRaw: 0n, allDebtAbsentProven: true, eModeCategory: 0, isolationMode: false }
};

describe("Aave Base action preview", () => {
  it("derives exact raw units and approval need from a canonical snapshot without calldata", async () => {
    snapshot.mockResolvedValue(baseSnapshot);
    const result = await previewAaveBaseAction({} as never, input, now);
    expect(snapshot).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      user: address, amountRaw: 1_500_000n, action: "supply", maxAgeMs: 30_000
    }));
    expect(result).toMatchObject({ action: "supply", symbol: "USDC", amount: "1.5",
      amountRaw: "1500000", approvalRequired: true, blockNumber: "100", debtStatus: "none" });
    expect(JSON.stringify(result)).not.toMatch(/calldata|transaction|0x617ba037/);
  });

  it("rejects unsupported precision, max mode, and insufficient wallet balance", async () => {
    snapshot.mockResolvedValue(baseSnapshot);
    await expect(previewAaveBaseAction({} as never, { ...input, amount: "1.0000001" }, now)).rejects.toThrow(/amount/i);
    await expect(previewAaveBaseAction({} as never, { ...input, amount: "0" }, now)).rejects.toThrow(/amount/i);
    snapshot.mockResolvedValue({ ...baseSnapshot, wallet: { balanceRaw: 1_000_000n, poolAllowanceRaw: 2_000_000n } });
    await expect(previewAaveBaseAction({} as never, input, now)).rejects.toThrow(/balance/i);
  });

  it("does not require token approval for a withdrawal or borrow", async () => {
    snapshot.mockResolvedValue({ ...baseSnapshot, action: "withdraw", account: { ...baseSnapshot.account,
      weightedCollateralBase: 160_000_000n, assetCollateralBalanceRaw: 2_000_000n },
      wallet: { balanceRaw: 0n, poolAllowanceRaw: 0n } });
    const result = await previewAaveBaseAction({} as never, { ...input, action: "withdraw" }, now);
    expect(result.approvalRequired).toBe(false);
  });
});
