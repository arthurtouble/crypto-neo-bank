/**
 * How the predictions screens write and work out what Polymarket reports:
 * typed amounts and shares, quick adds, Up or Down windows and assets,
 * countdowns, the live price stream's ticks, what a sale brings in, and a
 * failure in plain words. Pure functions, shared by the screens and their
 * unit tests; nothing here reads a venue.
 */

const LOCALE = "en-US";

/**
 * What a decimal field keeps of what was typed: digits and one decimal point,
 * at most `decimals` places and 9 whole digits, no leading zeros. "1.2.3" is
 * "1.2", "007" is "7", "." is "0.", and "12.345" with 2 places is "12.34".
 */
export function typedDecimal(text: string, decimals = 2): string {
  const cleaned = text.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  let whole = dot === -1 ? cleaned : cleaned.slice(0, dot);
  const fraction = dot === -1 ? null : cleaned.slice(dot + 1).replace(/\./g, "").slice(0, decimals);
  whole = whole.replace(/^0+(?=\d)/, "").slice(0, 9);
  if (fraction === null || decimals === 0) return whole;
  return `${whole || "0"}.${fraction}`;
}

/** A number of shares the customer typed: positive, at most two decimals, and no more than they hold. */
export function parseShares(text: string, held: number): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) return null;
  const value = Number(text);
  return value > 0 && value <= held + 1e-9 ? value : null;
}

/** Shares as the field holds them, rounded down to the hundredth so a sale never asks for more than is held: "40", "12.5". */
export function sharesText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return String(Math.floor(value * 100 + 1e-6) / 100);
}

/** A quick add (+$1, +$20, +$100) to the amount so far: "20" plus 1 is "21", "" plus 20 is "20". */
export function addDollars(current: string, add: number): string {
  const now = Number(current);
  const total = (Number.isFinite(now) ? now : 0) + add;
  return String(Math.round(total * 100) / 100);
}

/**
 * What a dollar buy at `price` comes to: about how many shares, and what they
 * pay if the outcome wins ($1 a share). Both are rounded down to the cent, so
 * the form never promises more than the shares pay: $10 at 64¢ is 15.62
 * shares and $15.62, not $15.63.
 */
export function buyEstimate(amount: number | null, price: number | null | undefined): { shares: number; toWin: number } | null {
  if (amount === null || !(amount > 0) || price === null || price === undefined || !(price > 0) || price >= 1) return null;
  const shares = Math.floor((amount / price) * 100 + 1e-9) / 100;
  return { shares, toWin: shares };
}

/** The quick adds above the amount, as Polymarket offers them. */
export const QUICK_ADDS = [1, 20, 100] as const;

/** An Up or Down window as words: "15M" is "15 min", "1H" "1 hour", "4H" "4 hours", "1D" "Daily". */
export function formatWindow(window: string | null | undefined): string | null {
  if (!window) return null;
  const match = /^(\d{1,3})([MHDW])$/i.exec(window);
  if (!match) return null;
  const count = Number(match[1]), unit = match[2].toUpperCase();
  if (unit === "M") return `${count} min`;
  if (unit === "H") return count === 1 ? "1 hour" : `${count} hours`;
  if (unit === "D") return count === 1 ? "Daily" : `${count} days`;
  return count === 1 ? "Weekly" : `${count} weeks`;
}

/** The windows the Up or Down list can be narrowed to, as Gamma tags them. */
export const UP_OR_DOWN_WINDOWS = ["5M", "15M", "1H", "4H", "1D"] as const;

/** The assets Polymarket runs Up or Down markets on: Gamma's tag, the price stream's symbol, and the name. */
const ASSETS: Array<{ symbol: string; tags: string[]; name: string }> = [
  { symbol: "btc", tags: ["bitcoin", "btc"], name: "Bitcoin" },
  { symbol: "eth", tags: ["ethereum", "eth"], name: "Ethereum" },
  { symbol: "sol", tags: ["solana", "sol"], name: "Solana" },
  { symbol: "xrp", tags: ["xrp", "ripple"], name: "XRP" },
  { symbol: "doge", tags: ["dogecoin", "doge"], name: "Dogecoin" },
  { symbol: "bnb", tags: ["bnb"], name: "BNB" },
  { symbol: "hype", tags: ["hyperliquid", "hype"], name: "Hyperliquid" },
  { symbol: "zec", tags: ["zcash", "zec"], name: "Zcash" }
];

export type UpOrDownInfo = {
  /** Gamma's window tag ("15M"), or null when it has none. */
  window: string | null;
  /** The price stream's symbol ("btc"), or null for an asset it doesn't carry. */
  symbol: string | null;
  /** The asset's name ("Bitcoin"), or null. */
  asset: string | null;
};

/**
 * Whether a market is a short crypto Up or Down market, and its window and
 * asset: from its tags (Gamma's "up-or-down", a window such as "15M", and an
 * asset such as "bitcoin") and its resolution source (a Chainlink stream such
 * as data.chain.link/streams/btc-usd-twap-60s-streams).
 */
export function upOrDownInfo(market: { tags: Array<{ slug: string }>; resolutionSource: string | null }): UpOrDownInfo | null {
  const slugs = market.tags.map((tag) => tag.slug.toLowerCase());
  if (!slugs.includes("up-or-down")) return null;
  const named: Record<string, string> = { hourly: "1H", daily: "1D", weekly: "1W" };
  const window = slugs.map((slug) => /^\d{1,3}[mhdw]$/.test(slug) ? slug.toUpperCase() : named[slug] ?? null).find(Boolean) ?? null;
  const fromSource = market.resolutionSource?.match(/data\.chain\.link\/streams\/([a-z\d]{1,12})-usd/i)?.[1]?.toLowerCase() ?? null;
  const asset = ASSETS.find((item) => item.symbol === fromSource) ?? ASSETS.find((item) => item.tags.some((tag) => slugs.includes(tag))) ?? null;
  return { window, symbol: asset?.symbol ?? fromSource, asset: asset?.name ?? null };
}

/**
 * Time left, as a countdown: "4:07" under an hour, "1h 05m" under a day, then
 * "2d 4h". Nothing left is "0:00".
 */
export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86_400), hours = Math.floor((seconds % 86_400) / 3_600), minutes = Math.floor((seconds % 3_600) / 60), rest = seconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** Where a timed market is: before its window, in it, or past its end. */
export function windowPhase(startTime: string | null, endDate: string | null, now: number): "before" | "open" | "ended" | "unknown" {
  const start = startTime ? Date.parse(startTime) : Number.NaN, end = endDate ? Date.parse(endDate) : Number.NaN;
  if (Number.isFinite(end) && now >= end) return "ended";
  if (Number.isFinite(start) && now < start) return "before";
  return Number.isFinite(end) ? "open" : "unknown";
}

export type Tick = { time: number; price: number };

/**
 * The ticks to keep after new ones arrive: sorted by time, one per
 * timestamp (the newest wins), none older than `since`, and at most `max`.
 */
export function mergeTicks(existing: Tick[], incoming: Tick[], since: number, max = 4_000): Tick[] {
  const byTime = new Map<number, number>();
  for (const tick of [...existing, ...incoming]) if (Number.isFinite(tick.time) && Number.isFinite(tick.price) && tick.price > 0 && tick.time >= since) byTime.set(tick.time, tick.price);
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).slice(-max).map(([time, price]) => ({ time, price }));
}

/**
 * Polymarket's live price stream (wss://ws-live-data.polymarket.com): the
 * Chainlink prices its Up or Down markets settle on, one connection per asset.
 */
export const PRICE_STREAM_URL = "wss://ws-live-data.polymarket.com";

/** The stream's subscribe message for one asset ("btc" is Chainlink's "btc/usd"). */
export function priceStreamSubscription(symbol: string): string {
  return JSON.stringify({ action: "subscribe", subscriptions: [{ topic: "crypto_prices_chainlink", type: "*", filters: JSON.stringify({ symbol: `${symbol}/usd` }) }] });
}

/**
 * The ticks in one stream message for `symbol`: the snapshot it sends on
 * subscribing (`payload.data`, about the last minute) or one update
 * (`payload.timestamp` and `value`). Anything else, including the reply to a
 * ping and other assets, is no ticks.
 */
export function streamTicks(raw: unknown, symbol: string): Tick[] {
  if (typeof raw !== "string" || !raw.startsWith("{")) return [];
  let message: { payload?: { symbol?: unknown; data?: unknown; timestamp?: unknown; value?: unknown } };
  try { message = JSON.parse(raw); } catch { return []; }
  const payload = message.payload;
  if (!payload || payload.symbol !== `${symbol}/usd`) return [];
  const tick = (item: { timestamp?: unknown; value?: unknown }): Tick[] =>
    typeof item.timestamp === "number" && typeof item.value === "number" && Number.isFinite(item.value) && item.value > 0 ? [{ time: item.timestamp, price: item.value }] : [];
  if (Array.isArray(payload.data)) return payload.data.flatMap((item) => item && typeof item === "object" ? tick(item as { timestamp?: unknown; value?: unknown }) : []);
  return tick(payload);
}

/**
 * The price an Up or Down market has to beat: Polymarket's own number when
 * it sent one, else the price stream's tick at the very second the window
 * started (which is the number Polymarket uses), else null.
 */
export function priceToBeatFrom(published: number | null | undefined, ticks: Tick[], startTime: string | null): { price: number; from: "polymarket" | "stream" } | null {
  if (published !== null && published !== undefined && Number.isFinite(published) && published > 0) return { price: published, from: "polymarket" };
  const start = startTime ? Date.parse(startTime) : Number.NaN;
  if (!Number.isFinite(start)) return null;
  const at = ticks.find((tick) => tick.time === start);
  return at ? { price: at.price, from: "stream" } : null;
}

/** A crypto price for the Up or Down screens: cents from $1, more places below ("$84,912.40", "$0.18234"). */
export function formatAssetPrice(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const options: Intl.NumberFormatOptions = Math.abs(value) >= 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumSignificantDigits: 5 };
  return value.toLocaleString(LOCALE, { style: "currency", currency: "USD", ...options });
}

/** The chance a range began at, in words for the chance chart: "Was 58% a week ago". */
export function chanceThen(points: Array<{ price: number }>, range: string): string | null {
  if (points.length < 2) return null;
  const ago: Record<string, string> = { "1h": "an hour ago", "6h": "6 hours ago", "1d": "a day ago", "1w": "a week ago", "1m": "a month ago", max: "at the start" };
  const first = points[0].price;
  if (!Number.isFinite(first)) return null;
  const percent = Math.round(first * 100);
  return `Was ${percent < 1 && first > 0 ? "<1" : percent > 99 && first < 1 ? ">99" : percent}% ${ago[range] ?? "at the start of the chart"}`;
}

/** Which outcome won a resolved market: the one Polymarket prices at $1, or null while it isn't decided. */
export function winningOutcome(market: { closed: boolean; outcomes: Array<{ price: number | null }> }): 0 | 1 | null {
  if (!market.closed) return null;
  const index = market.outcomes.findIndex((outcome) => outcome.price !== null && outcome.price >= 0.99);
  return index === 0 || index === 1 ? index : null;
}

/**
 * What selling `shares` brings in now: about shares × the best bid, and at
 * least shares × the lowest price the sale accepts (2% under the best bid,
 * on the market's price steps), as the server signs it.
 */
export function sellProceeds(shares: number, bestBid: number | null | undefined, tickSize = 0.01): { about: number; atLeast: number } | null {
  if (!(shares > 0) || bestBid === null || bestBid === undefined || !(bestBid > 0)) return null;
  const floor = Math.max(tickSize, Math.floor((bestBid * 0.98) / tickSize + 1e-9) * tickSize);
  return { about: shares * bestBid, atLeast: shares * floor };
}

/** Which setup step a passkey request is for: the order-book sign-in names Polymarket's ClobAuth; anything else is the approvals. */
export function setupStepOf(request: unknown): "approve" | "connect" {
  try { return /ClobAuth/.test(JSON.stringify(request)) ? "connect" : "approve"; } catch { return "approve"; }
}

/**
 * A failure in words a customer can act on, from the server's error code;
 * anything else keeps the server's own sentence.
 */
const ERROR_COPY: Record<string, string> = {
  chain_unavailable: "Your predictions account can't be reached right now. Nothing was sent. Try again in a minute.",
  unavailable: "Polymarket isn't answering right now. Nothing was sent. Try again in a minute.",
  markets_unavailable: "Polymarket isn't answering right now. Try again in a minute.",
  rate_limited: "Polymarket is busy. Wait a moment and try again.",
  invalid_response: "Polymarket's answer couldn't be read. Nothing was sent. Try again in a minute.",
  not_configured: "Predictions aren't ready yet. Nothing was sent. Try again later.",
  predictions_not_connected: "Your predictions account isn't set up yet. Deposit or buy to set it up.",
  market_closed: "This market has stopped taking orders.",
  not_found: "This market isn't available.",
  no_buyers: "No one is buying this outcome right now. Try again later.",
  insufficient_liquidity: "There aren't enough sellers near this price to fill it. Try a smaller amount.",
  fak_not_filled: "No one sold at this price in time, so nothing was bought. Try again.",
  fok_not_filled: "No one sold at this price in time, so nothing was bought. Try again.",
  unmatched: "No one matched your order, so nothing changed. Try again.",
  below_minimum: "That's below Polymarket's smallest order. Try a larger amount.",
  amount_too_small: "That's below the smallest amount Polymarket takes from Base.",
  nothing_to_redeem: "There's nothing to collect in this market yet.",
  unsupported_asset: "Polymarket isn't taking USDC from Base right now. Try again later.",
  insufficient_balance: "That's more than your predictions cash.",
  signature_expired: "That took too long, so nothing was sent. Try again.",
  signature_rejected: "Your passkey approval wasn't accepted. Nothing was sent.",
  feature_unavailable: "Predictions aren't available right now."
};

export function predictionErrorCopy(code: string | null | undefined, message: string): string {
  if (code === "amount_too_small" && /at least/.test(message)) return message;
  return (code && ERROR_COPY[code]) || message;
}
