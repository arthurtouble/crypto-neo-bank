import { formatUnits } from "viem";

type ReviewSelection = { fromAssetId: string; toAssetId: string; amount: string; walletAddress: string; slippageBps: number };

export function orderSwapRoutes<T extends { planId?: string }>(routes: readonly T[]): T[] {
  return [...routes.filter((route) => Boolean(route.planId)), ...routes.filter((route) => !route.planId)];
}

export function makeSwapReviewKey(input: ReviewSelection): string {
  return JSON.stringify([input.fromAssetId, input.toAssetId, input.amount, input.walletAddress.toLowerCase(), input.slippageBps]);
}

export function quoteIsFresh(expiresAt: string, now = Date.now()): boolean {
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires > now;
}

export function displayRawAmount(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Invalid token amount.");
  return formatUnits(BigInt(raw), decimals);
}

export function formatEstimatedFeeUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  if (value > 0 && value < 0.005) return "<$0.01";
  return `$${value.toFixed(2)}`;
}
