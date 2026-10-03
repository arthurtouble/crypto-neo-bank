/**
 * How the Markets screens write what Hyperliquid and Polymarket report:
 * names, prices, changes, and the amounts a trade needs. Pure functions,
 * shared by the screens and their unit tests; nothing here reads a venue.
 */

const LOCALE = "en-US";

/** A perp's name without its dex: "xyz:SPCX" is "SPCX". */
export function perpName(coin: string): string {
  const index = coin.indexOf(":");
  return index === -1 ? coin : coin.slice(index + 1);
}

/** The HIP-3 dex a stock perp trades on ("xyz"), or null for Hyperliquid's own markets. */
export function perpDex(coin: string): string | null {
  const index = coin.indexOf(":");
  return index === -1 ? null : coin.slice(0, index);
}

const finite = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/** The change since the price a day ago, in percent; null when either price is missing or the old one is zero. */
export function dayChangePercent(price: string | number | null | undefined, prevDayPrice: string | number | null | undefined): number | null {
  const now = finite(price), before = finite(prevDayPrice);
  if (now === null || before === null || before === 0) return null;
  return ((now - before) / before) * 100;
}

/** A signed percent: "+2.31%", "−1.20%" (a true minus sign), "0.00%". */
export function formatSignedPercent(value: number, decimals = 2): string {
  const rounded = Number(value.toFixed(decimals));
  const text = Math.abs(rounded).toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return rounded > 0 ? `+${text}%` : rounded < 0 ? `−${text}%` : `${text}%`;
}

/** A signed dollar amount, for profit and loss: "+$12.50", "−$3.10". */
export function formatSignedUsd(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const text = Math.abs(rounded).toLocaleString(LOCALE, { style: "currency", currency: "USD" });
  return rounded > 0 ? `+${text}` : rounded < 0 ? `−${text}` : text;
}

/**
 * A market price in dollars, with the precision the price needs: cents from
 * $1,000, four decimals from $1, and up to six significant digits below.
 */
export function formatPrice(value: string | number | null | undefined): string | null {
  const numeric = finite(value);
  if (numeric === null) return null;
  const magnitude = Math.abs(numeric);
  const options: Intl.NumberFormatOptions = magnitude >= 1_000 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : magnitude >= 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 4 }
      : { maximumSignificantDigits: 6 };
  return numeric.toLocaleString(LOCALE, { style: "currency", currency: "USD", ...options });
}

/** A large dollar amount, short: "$1.2B", "$845.3M", "$12.4K", "$950". */
export function formatCompactUsd(value: string | number | null | undefined): string | null {
  const numeric = finite(value);
  if (numeric === null) return null;
  return numeric.toLocaleString(LOCALE, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
}

/** An outcome's price as a chance: 0.634 is "63%". Below 1%, "<1%"; above 99%, ">99%". */
export function formatChance(price: number | null | undefined): string | null {
  if (price === null || price === undefined || !Number.isFinite(price)) return null;
  const percent = price * 100;
  if (percent > 0 && percent < 1) return "<1%";
  if (percent > 99 && percent < 100) return ">99%";
  return `${Math.round(percent)}%`;
}

/** An outcome's price in cents, as Polymarket shows it: 0.634 is "63.4¢", 0.05 is "5¢". */
export function formatCents(price: number | null | undefined): string | null {
  if (price === null || price === undefined || !Number.isFinite(price)) return null;
  return `${Number((price * 100).toFixed(1)).toLocaleString(LOCALE)}¢`;
}

/** Hyperliquid's hourly funding rate as a percent: "0.0013%". */
export function formatFunding(rate: string | number | null | undefined): string | null {
  const numeric = finite(rate);
  if (numeric === null) return null;
  return formatSignedPercent(numeric * 100, 4);
}

/** A share of what's available, rounded down to the cent, as an amount field holds it: "12.34". */
export function shareOf(available: number, fraction: number): string {
  if (!Number.isFinite(available) || available <= 0) return "";
  return (Math.floor(available * fraction * 100) / 100).toFixed(2).replace(/\.00$/, "");
}

/** Hyperliquid needs 5 USDC to arrive and Circle takes a small fee, so a perps deposit is at least 6 USDC. */
export const PERPS_MINIMUM_DEPOSIT = 6;

/**
 * What to add to the perps balance to cover `short` dollars of margin: the
 * shortfall plus a dollar for Circle's fee and price moves, at least the
 * minimum deposit, rounded up to the cent.
 */
export function perpsTopUp(short: number): number {
  if (!(short > 0)) return 0;
  return Math.max(PERPS_MINIMUM_DEPOSIT, Math.ceil((short + 1) * 100) / 100);
}

/** A dollar amount the customer typed: a positive number with at most two decimals, or null. */
export function parseDollars(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 ? value : null;
}

/** A price the customer typed, as the API takes it ("123.45"), or null. */
export function parsePrice(text: string): string | null {
  const trimmed = text.trim().replace(/^\$/, "").replaceAll(",", "");
  return /^\d+(\.\d+)?$/.test(trimmed) && Number(trimmed) > 0 ? trimmed : null;
}

/** One key on the amount keypad applied to the amount so far: digits, one decimal point, two decimals, and delete. */
export function pressKey(current: string, key: string): string {
  if (key === "delete") return current.slice(0, -1);
  if (key === ".") return current.includes(".") ? current : `${current || "0"}.`;
  if (!/^\d$/.test(key)) return current;
  if (/\.\d{2}$/.test(current)) return current;
  if (current === "0") return key;
  const next = `${current}${key}`;
  return next.replace(/\..*/, "").length > 9 ? current : next;
}

/** What `amount` dollars of an outcome at `price` pays if it wins: each share pays $1. */
export function payoutIfWins(amount: number, price: number | null | undefined): number | null {
  if (!(amount > 0) || price === null || price === undefined || !(price > 0) || price >= 1) return null;
  return amount / price;
}

/** Long or short from Hyperliquid's signed size. */
export const positionSide = (size: string | number): "long" | "short" => Number(size) < 0 ? "short" : "long";

/** Polymarket's tag for each category tab; "Up or Down" reads its own list. No sports. */
export const PREDICTION_CATEGORIES = [
  { key: "all", label: "All", tag: null },
  { key: "up-or-down", label: "Up or Down", tag: null },
  { key: "politics", label: "Politics", tag: "politics" },
  { key: "economy", label: "Economy", tag: "economy" },
  { key: "crypto", label: "Crypto", tag: "crypto" },
  { key: "tech", label: "Tech", tag: "tech" },
  { key: "culture", label: "Culture", tag: "pop-culture" }
] as const;

export type PredictionCategory = (typeof PREDICTION_CATEGORIES)[number]["key"];

/** The resolution source as a link when it is a web address on https, or null to show it as text. */
export function sourceLink(source: string | null | undefined): { href: string; host: string } | null {
  if (!source) return null;
  try {
    const url = new URL(source.trim());
    return url.protocol === "https:" ? { href: url.toString(), host: url.hostname.replace(/^www\./, "") } : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- a perp's chart, book, and order

/** The chart's ranges, as the buttons show them, and the candle size each uses (as `/api/perps/candles` reads them). */
export const PERP_RANGES = [
  { value: "live", label: "Live", intervalMs: 60_000, count: 30 },
  { value: "1h", label: "1H", intervalMs: 60_000, count: 60 },
  { value: "1d", label: "1D", intervalMs: 900_000, count: 96 },
  { value: "1w", label: "1W", intervalMs: 3_600_000, count: 168 },
  { value: "1m", label: "1M", intervalMs: 14_400_000, count: 180 },
  { value: "3m", label: "3M", intervalMs: 43_200_000, count: 180 },
  { value: "1y", label: "1Y", intervalMs: 86_400_000, count: 365 },
  { value: "all", label: "All", intervalMs: 604_800_000, count: 120 }
] as const;

export type PerpRange = (typeof PERP_RANGES)[number]["value"];

/** A signed change in price, with the precision the price needs: "+$1,140.00", "−$0.0123". */
export function formatSignedPrice(value: number): string | null {
  const text = formatPrice(Math.abs(value));
  if (text === null) return null;
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

/** A price without the dollar sign, for the order book's narrow price column: "64,250.00". */
export function formatBookPrice(value: string | number | null | undefined): string | null {
  return formatPrice(value)?.replace("$", "") ?? null;
}

/** A size in the market's coin, trimmed: "0.0015", "12.5", "1,250". */
export function formatSize(value: string | number | null | undefined): string | null {
  const numeric = finite(value);
  if (numeric === null) return null;
  const magnitude = Math.abs(numeric);
  return numeric.toLocaleString(LOCALE, { maximumFractionDigits: magnitude >= 1_000 ? 0 : magnitude >= 1 ? 2 : 5 });
}

export type BookRow = { price: string; size: string; total: number; depth: number };

/**
 * Both sides of the order book as rows, best price first: each row's running
 * total in dollars, and its depth as a share of the deeper side's total (0–1),
 * which the row's bar shows.
 */
export function bookRows(bids: Array<{ price: string; size: string }>, asks: Array<{ price: string; size: string }>, depth: number): { bids: BookRow[]; asks: BookRow[] } {
  const side = (levels: Array<{ price: string; size: string }>) => {
    let total = 0;
    return levels.slice(0, depth).map((level) => {
      total += (finite(level.price) ?? 0) * (finite(level.size) ?? 0);
      return { price: level.price, size: level.size, total, depth: 0 };
    });
  };
  const rows = { bids: side(bids), asks: side(asks) };
  const deepest = Math.max(rows.bids.at(-1)?.total ?? 0, rows.asks.at(-1)?.total ?? 0);
  for (const row of [...rows.bids, ...rows.asks]) row.depth = deepest > 0 ? row.total / deepest : 0;
  return rows;
}

/** The spread as a percent of the mid price, as the API gives it ("0.0016" is "0.002%"). */
export function formatSpreadPercent(value: string | null | undefined): string | null {
  const numeric = finite(value);
  if (numeric === null) return null;
  const decimals = numeric >= 1 ? 2 : 3;
  return `${numeric.toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

/** An estimated fee in dollars: cents, or "<$0.01" when it rounds to nothing. */
export function formatFee(value: string | number | null | undefined): string | null {
  const numeric = finite(value);
  if (numeric === null) return null;
  if (numeric > 0 && numeric < 0.01) return "<$0.01";
  return numeric.toLocaleString(LOCALE, { style: "currency", currency: "USD" });
}

/** The leverage typed in the number box, held between 1 and the market's maximum. */
export function clampLeverage(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(1, Math.round(value)));
}
