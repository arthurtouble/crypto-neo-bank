import { registeredAsset } from "@/lib/assets/registry";
import { formatToken, fromRaw } from "@/lib/format";
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

type Side = { id: string; symbol: string; decimals: number };

/**
 * The rate, priced the way people think of it: in the cash side when one side is cash ("1 AAPLc = 341.5 USDC" whether
 * buying or selling Apple), otherwise per unit of what is paid ("1 ETH = 0.0029 cbBTC").
 */
export function rateText(from: Side, to: Side, fromAmountRaw: string, toAmountRaw: string): string {
  const paid = fromRaw(fromAmountRaw, from.decimals);
  const received = fromRaw(toAmountRaw, to.decimals);
  if (!(paid > 0) || !(received > 0)) return "Unavailable";
  const cash = (side: Side) => registeredAsset(side.id)?.category === "cash";
  return cash(from) && !cash(to) ? `1 ${to.symbol} = ${formatToken(paid / received)} ${from.symbol}` : `1 ${from.symbol} = ${formatToken(received / paid)} ${to.symbol}`;
}

/**
 * The price difference: the dollar value paid, less the dollar value received, less the fees charged. It's what the
 * amount loses to the market, which nobody charges, so it has its own line apart from Fees. Null without both dollar
 * values, or when it rounds to nothing.
 */
export function priceDifferenceText(quote: { fromAmountUsd: string | null; toAmountUsd: string | null; providerFeeUsd: number | null }): string | null {
  const paid = Number(quote.fromAmountUsd); const received = Number(quote.toAmountUsd);
  if (quote.fromAmountUsd === null || quote.toAmountUsd === null || !Number.isFinite(paid) || !Number.isFinite(received) || paid <= 0) return null;
  const difference = paid - received - (quote.providerFeeUsd ?? 0);
  if (difference < 0.005) return null;
  return `About ${formatEstimatedFeeUsd(difference)} (${(difference / paid * 100).toFixed(2)}%)`;
}

/** The market price line for a stock, gold, or the euro: "Market price: 1 AAPLc = $341.51, as of Sun 7:59 AM." */
export function marketPriceText(symbol: string, usd: string, asOf: string): string {
  return `Market price: 1 ${symbol} = $${Number(usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}, as of ${asOf}.`;
}
