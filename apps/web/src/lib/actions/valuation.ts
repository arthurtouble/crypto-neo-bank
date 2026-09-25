/** USD value of an action's source amount, used only for customer limits and display. */
export type Valuation = { usdCents: number | null; source: string | null };

const MAX_CANDLE_AGE_MS = 180_000;
const MAX_RESPONSE_BYTES = 256_000;

// Identified by chain and contract, never by ticker.
const STABLECOINS = new Set([
  "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  "10:0x0b2c639c533813f4aa9d7837caf62653d097ff85"
]);
const ETHER = new Set(["8453:native", "1:native", "42161:native", "10:native", "8453:0x4200000000000000000000000000000000000006"]);

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
async function krakenEthUsd(now: Date, fetcher: typeof fetch): Promise<string | null> {
  try {
    const response = await fetcher(`https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1&since=${Math.floor(now.getTime() / 1000) - 180}`,
      { signal: AbortSignal.timeout(4_000), headers: { Accept: "application/json" } });
    const length = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || length > MAX_RESPONSE_BYTES) return null;
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return null;
    const payload = JSON.parse(text) as { error?: unknown[]; result?: Record<string, unknown> };
    const candles = payload.result?.XETHZUSD ?? payload.result?.ETHUSD;
    if (payload.error?.length || !Array.isArray(candles) || !candles.length) return null;
    const latest = candles[candles.length - 1] as unknown[];
    if (typeof latest[0] !== "number" || typeof latest[2] !== "string") return null;
    const age = now.getTime() - latest[0] * 1000;
    return age >= -60_000 && age <= MAX_CANDLE_AGE_MS ? latest[2] : null;
  } catch { return null; }
}

/**
 * Stablecoins count at $1 even below peg, so a depeg never lowers a limit
 * check. Ether uses a fresh Kraken candle. Anything else uses the route
 * provider's quoted value when there is one.
 */
export async function valueAsset(input: { assetId: string; amountRaw: string; decimals: number; quotedUsd?: string | null },
  options: { now?: Date; fetcher?: typeof fetch } = {}): Promise<Valuation> {
  const assetId = input.assetId.toLowerCase();
  const raw = BigInt(input.amountRaw);
  if (STABLECOINS.has(assetId)) return { usdCents: centsOf(raw, input.decimals, { numerator: 1n, scale: 1n }), source: "stablecoin:par" };
  if (ETHER.has(assetId)) {
    const price = await krakenEthUsd(options.now ?? new Date(), options.fetcher ?? fetch);
    const parsed = price ? decimal(price) : null;
    if (parsed && parsed.numerator > 0n) return { usdCents: centsOf(raw, input.decimals, parsed), source: "kraken:ohlc:1m:ETHUSD:high" };
  }
  const quoted = input.quotedUsd ? decimal(input.quotedUsd) : null;
  if (quoted) {
    const cents = (quoted.numerator * 100n + quoted.scale - 1n) / quoted.scale;
    if (cents <= BigInt(Number.MAX_SAFE_INTEGER)) return { usdCents: Number(cents), source: "lifi:quote" };
  }
  return { usdCents: null, source: null };
}
