import { formatUnits } from "@/lib/format/units";

export function displayRawAmount(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Invalid token amount.");
  return formatUnits(BigInt(raw), decimals);
}

export function formatEstimatedFeeUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  if (value > 0 && value < 0.005) return "<$0.01";
  return `$${value.toFixed(2)}`;
}
