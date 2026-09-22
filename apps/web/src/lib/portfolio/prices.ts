import { z } from "zod";
import type { AssetId } from "@/lib/swap/assets";
import type { PriceObservation } from "./types";

const DAY_MS = 86_400_000;
const MAX_BYTES = 512_000;
const decimal = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
const candleSchema = z.tuple([z.number().int(), z.string(), z.string(), z.string(), z.string(), z.string(), z.string(), z.number().int()]);
const responseSchema = z.object({ error: z.array(z.string()), result: z.record(z.string(), z.unknown()) });
const instruments: Readonly<Record<string, { pair: string; responseKeys: readonly string[] }>> = {
  "8453:native": { pair: "ETHUSD", responseKeys: ["XETHZUSD", "ETHUSD"] },
  "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { pair: "USDCUSD", responseKeys: ["USDCUSD"] }
};

type Dependencies = { fetcher?: typeof fetch; now?: () => number };

function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00.000Z`))
    && new Date(`${day}T00:00:00.000Z`).toISOString().startsWith(day);
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || !response.body || !Number.isFinite(length) || length > MAX_BYTES) throw new Error("Portfolio price source is unavailable.");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Portfolio price source is unavailable."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch { throw new Error("Portfolio price source is unavailable."); }
}

/** Only observed, complete UTC daily closes become price evidence. Missing stays missing. */
export async function loadObservedUsdPrices(
  assetIds: AssetId[], days: string[], dependencies: Dependencies = {}
): Promise<PriceObservation[]> {
  const uniqueDays = [...new Set(days)].sort();
  if (uniqueDays.length > 366 || uniqueDays.some((day) => !validDay(day))) throw new Error("Invalid portfolio price range.");
  if (!uniqueDays.length) return [];
  const now = (dependencies.now ?? Date.now)();
  const requested = new Set(uniqueDays);
  const observations: PriceObservation[] = [];
  for (const assetId of new Set(assetIds)) {
    const instrument = instruments[assetId];
    if (!instrument) continue;
    const url = new URL("https://api.kraken.com/0/public/OHLC");
    url.searchParams.set("pair", instrument.pair);
    url.searchParams.set("interval", "1440");
    url.searchParams.set("since", String(Date.parse(`${uniqueDays[0]}T00:00:00.000Z`) / 1000));
    let payload: unknown;
    try {
      const response = await (dependencies.fetcher ?? fetch)(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
      payload = await boundedJson(response);
    } catch { throw new Error("Portfolio price source is unavailable."); }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.error.length) throw new Error("Portfolio price source is unavailable.");
    const matching = Object.entries(parsed.data.result).filter(([key]) => instrument.responseKeys.includes(key));
    if (matching.length !== 1) continue;
    const candles = z.array(candleSchema).safeParse(matching[0][1]);
    if (!candles.success) continue;
    const byDay = new Map<string, PriceObservation>();
    const duplicates = new Set<string>();
    for (const row of candles.data) {
      const timestamp = row[0] * 1000;
      if (!Number.isSafeInteger(timestamp) || timestamp % DAY_MS !== 0 || timestamp + DAY_MS > now || row[7] <= 0) continue;
      const day = new Date(timestamp).toISOString().slice(0, 10);
      if (!requested.has(day) || !decimal.test(row[4]) || BigInt(row[4].replace(".", "")) === 0n) continue;
      if (byDay.has(day)) { byDay.delete(day); duplicates.add(day); continue; }
      if (duplicates.has(day)) continue;
      byDay.set(day, { assetId, day, usd: row[4], sourceId: "kraken-spot-ohlc", observedAt: new Date(now).toISOString(), methodology: `${instrument.pair}:UTC-daily-close`, version: 1 });
    }
    observations.push(...byDay.values());
  }
  return observations.sort((a, b) => a.assetId.localeCompare(b.assetId) || a.day.localeCompare(b.day));
}
