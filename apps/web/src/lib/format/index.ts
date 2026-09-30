/**
 * Client-safe formatters for money, amounts, dates, and addresses, in one
 * locale ("en-US") so every screen writes them the same way
 * (docs/product/design-system.md, "Money formatting").
 */

const LOCALE = "en-US";

const usdFormat = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "USD" });
const usdWholeFormat = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Dollars with cents: "$1,234.50". `whole` drops the cents: "$1,235". */
export function formatUsd(value: number | string, options: { whole?: boolean } = {}) {
  const numeric = typeof value === "number" ? value : Number(value);
  return (options.whole ? usdWholeFormat : usdFormat).format(numeric);
}

/** Dollars from cents: 123450 is "$1,234.50". */
export const formatCents = (cents: number) => formatUsd(cents / 100);

/**
 * A token amount: thousands separated, up to 4 decimals, or 6 below 1, trailing
 * zeros dropped. With a symbol: "2,650 USDC". `maxDecimals` shows more where
 * the exact amount matters (an Earn position as read).
 */
export function formatToken(value: number | string, symbol?: string, options: { maxDecimals?: number } = {}) {
  const numeric = typeof value === "number" ? value : Number(value);
  const text = numeric.toLocaleString(LOCALE, { maximumFractionDigits: options.maxDecimals ?? (numeric !== 0 && Math.abs(numeric) < 1 ? 6 : 4) });
  return symbol ? `${text} ${symbol}` : text;
}

/** A raw on-chain integer amount as a number of whole tokens. */
export const fromRaw = (raw: string | bigint, decimals: number) => Number(raw) / 10 ** decimals;

/** Date and time, medium: "Sep 30, 2026, 8:12 PM". */
export const formatDateTime = (value: string | number | Date) =>
  new Date(value).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" });

/** A short date and time for lists: "Sep 30, 8:12 PM". */
export const formatShortDateTime = (value: string | number | Date) =>
  new Date(value).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A time of day: "8:12 PM". */
export const formatTime = (value: string | number | Date) =>
  new Date(value).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });

/** A weekday and time, for prices that pause outside market hours: "Wed 8:12 PM". */
export const formatWeekdayTime = (value: string | number | Date) =>
  new Date(value).toLocaleString(LOCALE, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** An address shortened to its first six and last four characters: "0x5555…5555". */
export function shortAddress(address: string | null | undefined) {
  if (!address) return "";
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
