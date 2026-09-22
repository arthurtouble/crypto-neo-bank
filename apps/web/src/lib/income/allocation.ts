export type IncomeAllocation = {
  spendingPercent: number;
  goalsPercent: number;
  earnPercent: number;
};

export function allocationTotal(allocation: IncomeAllocation) {
  return allocation.spendingPercent + allocation.goalsPercent + allocation.earnPercent;
}

export function allocationIsValid(allocation: IncomeAllocation) {
  return Object.values(allocation).every((value) => Number.isInteger(value) && value >= 0 && value <= 100)
    && allocationTotal(allocation) === 100;
}

export function allocationPreview(amount: number, allocation: IncomeAllocation) {
  if (!Number.isFinite(amount) || amount < 0 || !allocationIsValid(allocation)) return null;
  return {
    spending: amount * allocation.spendingPercent / 100,
    goals: amount * allocation.goalsPercent / 100,
    earn: amount * allocation.earnPercent / 100
  };
}
