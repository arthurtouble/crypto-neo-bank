// Only reviewed Base transfer assets are valued here. A ticker symbol alone is never
// sufficient to identify a token on another chain.
export const VALUATION_POLICY_VERSION = 1;
const MAX_CANDLE_AGE_MS = 180_000;
const MAX_RESPONSE_BYTES = 256_000;

export class ValuationError extends Error {
  constructor(message: string) { super(message); this.name = "ValuationError"; }
}

export type TrustedValuation = {
  assetId: string;
  rawUnits: string;
  decimals: number;
  priceUsd: string;
  marketPriceUsd: string;
  priceSource: string;
  priceObservedAt: string;
  valuedAt: string;
  usdCents: string;
  policyVersion: number;
  depegUncertainty: boolean;
};

type Input = { type: string; chainId: number; asset: string; amount: string };
type Options = { now?: Date; fetcher?: typeof fetch };

function decimalParts(value: string, maximumFraction: number): { numerator: bigint; scale: bigint } {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > maximumFraction) throw new ValuationError("Invalid amount or price precision.");
  const fraction = match[2] ?? "";
  return { numerator: BigInt(match[1] + fraction), scale: 10n ** BigInt(fraction.length) };
}

function resolve(input: Input) {
  if (input.type !== "transfer" || input.chainId !== 8453) throw new ValuationError("Unsupported action or chain for trusted valuation.");
  const asset = input.asset.toLowerCase();
  if (asset === "eth" || asset === "8453:native") return { assetId: "8453:native", decimals: 18, pair: "ETH/USD", stable: false };
  if (asset === "weth" || asset === "0x4200000000000000000000000000000000000006" || asset === "8453:0x4200000000000000000000000000000000000006") return { assetId: "8453:0x4200000000000000000000000000000000000006", decimals: 18, pair: "ETH/USD", stable: false };
  if (asset === "usdc" || asset === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" || asset === "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") return { assetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, pair: "USDC/USD", stable: true };
  throw new ValuationError("Unsupported asset for trusted valuation.");
}

async function readBounded(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new ValuationError("Price source unavailable.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new ValuationError("Price response exceeds size limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new ValuationError("Invalid price response."); }
}

export async function valueTransfer(input: Input, options: Options = {}): Promise<TrustedValuation> {
  const now = options.now ?? new Date();
  const asset = resolve(input);
  const amount = decimalParts(input.amount, asset.decimals);
  const rawUnits = amount.numerator * (10n ** BigInt(asset.decimals)) / amount.scale;
  if (rawUnits <= 0n || rawUnits.toString().length > 78) throw new ValuationError("Invalid amount.");
  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(asset.pair)}&assetVersion=1&interval=1&since=${Math.floor(now.getTime() / 1000) - 180}`;
  let payload: unknown;
  try {
    payload = await readBounded(await (options.fetcher ?? fetch)(url, { signal: AbortSignal.timeout(4_000), headers: { Accept: "application/json" } }));
  } catch (error) {
    if (error instanceof ValuationError) throw error;
    throw new ValuationError("Price source unavailable.");
  }
  const data = payload as { error?: unknown; result?: Record<string, unknown> };
  if (!data || !Array.isArray(data.error) || data.error.length || !data.result) throw new ValuationError("Price source unavailable.");
  const candles = data.result[asset.pair];
  if (!Array.isArray(candles) || !candles.length) throw new ValuationError("Price source unavailable.");
  const latest = candles[candles.length - 1];
  if (!Array.isArray(latest) || typeof latest[0] !== "number" || typeof latest[2] !== "string" || typeof latest[7] !== "number" || latest[7] <= 0) throw new ValuationError("Price evidence is stale or invalid.");
  const observedAtMs = latest[0] * 1000;
  if (now.getTime() - observedAtMs > MAX_CANDLE_AGE_MS || observedAtMs > now.getTime() + 60_000) throw new ValuationError("Price evidence is stale.");
  const market = decimalParts(latest[2], 12); // high of the fresh one-minute candle
  if (market.numerator <= 0n) throw new ValuationError("Invalid market price.");
  const riskPrice = asset.stable && market.numerator < market.scale ? { numerator: 1n, scale: 1n } : market;
  const numerator = rawUnits * riskPrice.numerator * 100n;
  const denominator = 10n ** BigInt(asset.decimals) * riskPrice.scale;
  const cents = (numerator + denominator - 1n) / denominator;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new ValuationError("Valuation exceeds supported policy range.");
  return {
    assetId: asset.assetId, rawUnits: rawUnits.toString(), decimals: asset.decimals,
    priceUsd: asset.stable && market.numerator < market.scale ? "1" : latest[2],
    marketPriceUsd: latest[2],
    priceSource: `kraken:ohlc:1m:${asset.pair}:high`, priceObservedAt: new Date(observedAtMs).toISOString(),
    valuedAt: now.toISOString(), usdCents: cents.toString(), policyVersion: VALUATION_POLICY_VERSION,
    depegUncertainty: asset.stable
  };
}

// Source-asset spend limits use reviewed chain/contract identities, never a
// provider ticker or its quoted USD amount. Unknown identities fail closed.
const swapAssets: Readonly<Record<string, { decimals: number; pair: string; keys: readonly string[]; stable: boolean }>> = {
  "8453:native": { decimals: 18, pair: "ETH/USD", keys: ["XETHZUSD", "ETHUSD", "ETH/USD"], stable: false },
  "1:native": { decimals: 18, pair: "ETH/USD", keys: ["XETHZUSD", "ETHUSD", "ETH/USD"], stable: false },
  "42161:native": { decimals: 18, pair: "ETH/USD", keys: ["XETHZUSD", "ETHUSD", "ETH/USD"], stable: false },
  "10:native": { decimals: 18, pair: "ETH/USD", keys: ["XETHZUSD", "ETHUSD", "ETH/USD"], stable: false },
  "8453:0x4200000000000000000000000000000000000006": { decimals: 18, pair: "ETH/USD", keys: ["XETHZUSD", "ETHUSD", "ETH/USD"], stable: false },
  "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { decimals: 6, pair: "USDC/USD", keys: ["USDCUSD", "USDC/USD"], stable: true },
  "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { decimals: 6, pair: "USDC/USD", keys: ["USDCUSD", "USDC/USD"], stable: true },
  "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831": { decimals: 6, pair: "USDC/USD", keys: ["USDCUSD", "USDC/USD"], stable: true },
  "10:0x0b2c639c533813f4aa9d7837caf62653d097ff85": { decimals: 6, pair: "USDC/USD", keys: ["USDCUSD", "USDC/USD"], stable: true }
};

export async function valueSwapSource(
  input: { assetId: string; amountRaw: string }, options: Options = {}
): Promise<TrustedValuation> {
  const asset = Object.hasOwn(swapAssets, input.assetId) ? swapAssets[input.assetId] : undefined;
  if (!asset) throw new ValuationError("Unsupported asset for trusted swap valuation.");
  if (!/^[1-9]\d{0,77}$/.test(input.amountRaw)) throw new ValuationError("Invalid source amount.");
  const rawUnits = BigInt(input.amountRaw);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new ValuationError("Invalid valuation time.");
  const pair = asset.pair.replace("/", "");
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1&since=${Math.floor(now.getTime() / 1000) - 180}`;
  let payload: unknown;
  try {
    payload = await readBounded(await (options.fetcher ?? fetch)(url, {
      signal: AbortSignal.timeout(4_000), headers: { Accept: "application/json" }
    }));
  } catch (error) {
    if (error instanceof ValuationError) throw error;
    throw new ValuationError("Price source unavailable.");
  }
  const data = payload as { error?: unknown; result?: Record<string, unknown> } | null;
  if (!data || !Array.isArray(data.error) || data.error.length || !data.result || typeof data.result !== "object") {
    throw new ValuationError("Price source unavailable.");
  }
  const matches = asset.keys.filter((key) => Object.hasOwn(data.result!, key));
  if (matches.length !== 1) throw new ValuationError("Ambiguous or missing price evidence.");
  const candles = data.result[matches[0]];
  if (!Array.isArray(candles) || !candles.length) throw new ValuationError("Price source unavailable.");
  const latest = candles[candles.length - 1];
  if (!Array.isArray(latest) || !Number.isSafeInteger(latest[0]) || typeof latest[2] !== "string"
      || !Number.isSafeInteger(latest[7]) || latest[7] <= 0) {
    throw new ValuationError("Price evidence is stale or invalid.");
  }
  const observedAtMs = latest[0] * 1000;
  if (now.getTime() - observedAtMs > MAX_CANDLE_AGE_MS || observedAtMs > now.getTime() + 60_000) {
    throw new ValuationError("Price evidence is stale.");
  }
  const market = decimalParts(latest[2], 12);
  if (market.numerator <= 0n) throw new ValuationError("Invalid market price.");
  const belowPeg = asset.stable && market.numerator < market.scale;
  const riskPrice = belowPeg ? { numerator: 1n, scale: 1n } : market;
  const denominator = (10n ** BigInt(asset.decimals)) * riskPrice.scale;
  const cents = (rawUnits * riskPrice.numerator * 100n + denominator - 1n) / denominator;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new ValuationError("Valuation exceeds supported policy range.");
  return {
    assetId: input.assetId, rawUnits: input.amountRaw, decimals: asset.decimals,
    priceUsd: belowPeg ? "1" : latest[2], marketPriceUsd: latest[2],
    priceSource: `kraken:ohlc:1m:${asset.pair}:high`, priceObservedAt: new Date(observedAtMs).toISOString(),
    valuedAt: now.toISOString(), usdCents: cents.toString(), policyVersion: VALUATION_POLICY_VERSION,
    depegUncertainty: asset.stable
  };
}
