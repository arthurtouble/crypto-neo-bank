import { registeredAsset } from "@/lib/assets/registry";
import { localEdgeUrl } from "@/lib/testing/local-edge";

/** USD value of an action's source amount, used only for customer limits and display. */
export type Valuation = { usdCents: number | null; source: string | null };

const MAX_CANDLE_AGE_MS = 180_000;
const MAX_RESPONSE_BYTES = 256_000;

/** Kraken pair and the result keys Kraken may use for it. */
const KRAKEN = { eth: { pair: "ETHUSD", keys: ["XETHZUSD", "ETHUSD"] }, btc: { pair: "XBTUSD", keys: ["XXBTZUSD", "XBTUSD"] } } as const;
export type KrakenAsset = keyof typeof KRAKEN;

function centsOf(rawUnits: bigint, decimals: number, price: { numerator: bigint; scale: bigint }): number | null {
  const denominator = 10n ** BigInt(decimals) * price.scale;
  const cents = (rawUnits * price.numerator * 100n + denominator - 1n) / denominator;
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

function decimal(value: string): { numerator: bigint; scale: bigint } | null {
  const match = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  return { numerator: BigInt(match[1] + fraction), scale: 10n ** BigInt(fraction.length) };
}

/** The high of the latest one-minute Kraken candle, if it is fresh. */
export async function krakenUsd(asset: KrakenAsset, now: Date, fetcher: typeof fetch = fetch): Promise<string | null> {
  const { pair, keys } = KRAKEN[asset];
  try {
    const response = await fetcher(`${localEdgeUrl("KRAKEN_API_URL") ?? "https://api.kraken.com"}/0/public/OHLC?pair=${pair}&interval=1&since=${Math.floor(now.getTime() / 1000) - 180}`,
      { signal: AbortSignal.timeout(4_000), headers: { Accept: "application/json" } });
    const length = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || length > MAX_RESPONSE_BYTES) return null;
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return null;
    const payload = JSON.parse(text) as { error?: unknown[]; result?: Record<string, unknown> };
    const candles = keys.map((key) => payload.result?.[key]).find(Array.isArray);
    if (payload.error?.length || !Array.isArray(candles) || !candles.length) return null;
    const latest = candles[candles.length - 1] as unknown[];
    if (typeof latest[0] !== "number" || typeof latest[2] !== "string") return null;
    const age = now.getTime() - latest[0] * 1000;
    return age >= -60_000 && age <= MAX_CANDLE_AGE_MS ? latest[2] : null;
  } catch { return null; }
}

/**
 * Each registered asset's price source decides its value. Stablecoins count
 * at $1 even below peg, so a depeg never lowers a limit check. Ether and
 * bitcoin use a fresh Kraken candle. Anything else uses the route provider's
 * quoted value when there is one.
 */
export async function valueAsset(input: { assetId: string; amountRaw: string; decimals: number; quotedUsd?: string | null },
  options: { now?: Date; fetcher?: typeof fetch } = {}): Promise<Valuation> {
  const price = registeredAsset(input.assetId)?.price;
  const raw = BigInt(input.amountRaw);
  if (price?.kind === "usd") return { usdCents: centsOf(raw, input.decimals, { numerator: 1n, scale: 1n }), source: "stablecoin:par" };
  const market: KrakenAsset | null = price?.kind === "kraken" ? price.market : null;
  if (market) {
    const price = await krakenUsd(market, options.now ?? new Date(), options.fetcher ?? fetch);
    const parsed = price ? decimal(price) : null;
    if (parsed && parsed.numerator > 0n) return { usdCents: centsOf(raw, input.decimals, parsed), source: `kraken:ohlc:1m:${KRAKEN[market].pair}:high` };
  }
  const quoted = input.quotedUsd ? decimal(input.quotedUsd) : null;
  if (quoted) {
    const cents = (quoted.numerator * 100n + quoted.scale - 1n) / quoted.scale;
    if (cents <= BigInt(Number.MAX_SAFE_INTEGER)) return { usdCents: Number(cents), source: "lifi:quote" };
  }
  return { usdCents: null, source: null };
}
