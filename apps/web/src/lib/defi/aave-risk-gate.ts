export type AaveRiskAction = "supply" | "withdraw" | "borrow" | "repay";

export type AaveRiskInput = {
  action: AaveRiskAction;
  amountRaw: bigint;
  nowMs: number;
  maxAgeMs: number;
  minHealthFactorWad: bigint;
  snapshot: { blockNumber: bigint; blockHash: string; observedAtMs: number; complete: boolean };
  reserve: {
    decimals: number; priceBase: bigint; liquidationThresholdBps: number;
    active: boolean; paused: boolean; frozen: boolean; borrowingEnabled: boolean;
    collateralEnabledForUser: boolean; availableLiquidityRaw: bigint;
    supplyCapRemainingRaw: bigint; borrowCapRemainingRaw: bigint;
  };
  account: {
    weightedCollateralBase: bigint; debtBase: bigint;
    assetCollateralBalanceRaw: bigint; assetDebtRaw: bigint;
    eModeCategory: number; isolationMode: boolean;
  };
};

function nonnegative(value: unknown, name: string): asserts value is bigint {
  if (typeof value !== "bigint" || value < 0n) throw new Error(`Invalid ${name}.`);
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/** Conservative calculation only; it is not an authority to sign or execute. */
export function assessAaveActionRisk(input: AaveRiskInput): {
  valueBase: bigint; postDebtBase: bigint; postWeightedCollateralBase: bigint; postHealthFactorWad: bigint | null;
} {
  const { action, amountRaw, snapshot, reserve, account } = input;
  if (!["supply", "withdraw", "borrow", "repay"].includes(action)) throw new Error("Unsupported Aave action.");
  nonnegative(amountRaw, "amount");
  if (amountRaw === 0n) throw new Error("Amount must be positive.");
  if (!Number.isSafeInteger(input.nowMs) || !Number.isSafeInteger(input.maxAgeMs) || input.maxAgeMs <= 0) throw new Error("Invalid snapshot clock.");
  nonnegative(snapshot.blockNumber, "block number");
  if (!snapshot.complete || snapshot.blockNumber === 0n || !/^0x[a-f\d]{64}$/i.test(snapshot.blockHash)
    || /^0x0{64}$/i.test(snapshot.blockHash)
    || !Number.isSafeInteger(snapshot.observedAtMs)
    || snapshot.observedAtMs > input.nowMs
    || input.nowMs - snapshot.observedAtMs > input.maxAgeMs) throw new Error("Incomplete or stale block-bound Aave snapshot.");
  nonnegative(input.minHealthFactorWad, "health floor");
  if (input.minHealthFactorWad <= 10n ** 18n) throw new Error("Health floor must exceed liquidation threshold.");
  if (!Number.isInteger(reserve.decimals) || reserve.decimals < 0 || reserve.decimals > 36
    || !Number.isInteger(reserve.liquidationThresholdBps) || reserve.liquidationThresholdBps < 0 || reserve.liquidationThresholdBps > 10_000) throw new Error("Invalid reserve parameters.");
  if ([reserve.active, reserve.paused, reserve.frozen, reserve.borrowingEnabled, reserve.collateralEnabledForUser]
    .some((value) => typeof value !== "boolean")) throw new Error("Incomplete reserve configuration.");
  for (const [name, value] of Object.entries({
    priceBase: reserve.priceBase, availableLiquidityRaw: reserve.availableLiquidityRaw,
    supplyCapRemainingRaw: reserve.supplyCapRemainingRaw, borrowCapRemainingRaw: reserve.borrowCapRemainingRaw,
    weightedCollateralBase: account.weightedCollateralBase, debtBase: account.debtBase,
    assetCollateralBalanceRaw: account.assetCollateralBalanceRaw, assetDebtRaw: account.assetDebtRaw
  })) nonnegative(value, name);
  if (reserve.priceBase === 0n || !reserve.active || reserve.paused) throw new Error("Reserve unavailable.");
  if (account.eModeCategory !== 0 || account.isolationMode !== false) throw new Error("Position mode unsupported.");
  if (reserve.frozen && (action === "supply" || action === "borrow")) throw new Error("Reserve frozen.");
  if (action === "borrow" && !reserve.borrowingEnabled) throw new Error("Borrowing disabled.");

  const scale = 10n ** BigInt(reserve.decimals);
  const valueBase = amountRaw * reserve.priceBase / scale;
  const upperValueBase = ceilDiv(amountRaw * reserve.priceBase, scale);
  if (valueBase === 0n) throw new Error("Amount too small for oracle precision.");
  let postDebtBase = account.debtBase;
  let postWeightedCollateralBase = account.weightedCollateralBase;
  if (action === "supply") {
    if (amountRaw > reserve.supplyCapRemainingRaw) throw new Error("Supply cap exceeded.");
    if (reserve.collateralEnabledForUser)
      postWeightedCollateralBase += valueBase * BigInt(reserve.liquidationThresholdBps) / 10_000n;
  } else if (action === "withdraw") {
    if (amountRaw > account.assetCollateralBalanceRaw || amountRaw > reserve.availableLiquidityRaw) throw new Error("Withdrawal unavailable.");
    if (reserve.collateralEnabledForUser) {
      const reduction = ceilDiv(upperValueBase * BigInt(reserve.liquidationThresholdBps), 10_000n);
      if (reduction > postWeightedCollateralBase) throw new Error("Collateral balance inconsistent.");
      postWeightedCollateralBase -= reduction;
    }
  } else if (action === "borrow") {
    if (amountRaw > reserve.borrowCapRemainingRaw || amountRaw > reserve.availableLiquidityRaw) throw new Error("Borrow unavailable.");
    postDebtBase += upperValueBase;
  } else {
    if (amountRaw > account.assetDebtRaw || valueBase > postDebtBase) throw new Error("Repayment exceeds debt.");
    postDebtBase -= valueBase;
  }
  if (postDebtBase > 0n && postWeightedCollateralBase * 10n ** 18n < postDebtBase * input.minHealthFactorWad)
    throw new Error("Post-action health factor is below the floor.");
  return {
    valueBase, postDebtBase, postWeightedCollateralBase,
    postHealthFactorWad: postDebtBase === 0n ? null : postWeightedCollateralBase * 10n ** 18n / postDebtBase
  };
}
