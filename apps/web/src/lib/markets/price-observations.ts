import { z } from "zod";
import { CATALOG_REGISTRY } from "@/lib/swap/catalog-registry";
import type { PriceObservation } from "@/lib/swap/reminder-decisions";
import { sourceInstantNs } from "@/lib/markets/source-instant";

// This is a deliberately narrow, reviewed market-to-contract mapping. Kraken
// ETH/USD is a market observation, not a price oracle or execution quote.
const reviewed = { pairId: "ETH/USD", baseAssetId: "8453:native", quoteAssetId: "iso4217:USD", mappingVersion: "kraken-posttrade-eth-usd-v1" } as const;
const MAX_RESPONSE_BYTES = 128_000;
const pricePattern = /^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/;
const tradeSchema = z.object({
  trade_id: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
  price: z.string().regex(pricePattern).refine((value) => /[1-9]/.test(value)),
  symbol: z.literal("ETH/USD"), base_asset: z.literal("ETH"), quote_asset: z.literal("USD"),
  trade_ts: z.iso.datetime({ offset: true }), publication_ts: z.iso.datetime({ offset: true }),
  trade_venue: z.string().min(1).max(20)
});
const responseSchema = z.object({
  error: z.array(z.string()),
  result: z.object({ count: z.number().int().nonnegative(), last_ts: z.string(), trades: z.array(tradeSchema).min(1).max(10) })
});

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("Spot price source is unavailable.");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_RESPONSE_BYTES) throw new Error("Spot price source returned an oversized response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Spot price source returned an oversized response.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } finally { await reader.cancel().catch(() => undefined); }
}

export async function getReviewedSpotObservation(
  selection: { pairId: string; baseAssetId: string; quoteAssetId: string },
  dependencies: { fetcher?: typeof fetch; now?: () => number; checkEligibility?: (assetId: string) => Promise<boolean> } = {}
): Promise<PriceObservation> {
  if (selection.pairId !== reviewed.pairId || selection.baseAssetId !== reviewed.baseAssetId
    || selection.quoteAssetId !== reviewed.quoteAssetId || !CATALOG_REGISTRY.verified.has(reviewed.baseAssetId)
    || CATALOG_REGISTRY.denied.has(reviewed.baseAssetId) || CATALOG_REGISTRY.regulated.has(reviewed.baseAssetId)) {
    throw new Error("Market-to-asset mapping is not reviewed.");
  }
  // Identity verification is not a country, risk, or feature eligibility decision.
  if (!dependencies.checkEligibility || !await dependencies.checkEligibility(reviewed.baseAssetId).catch(() => false)) {
    throw new Error("Current asset eligibility could not be confirmed.");
  }
  const fetcher = dependencies.fetcher ?? fetch;
  const response = await fetcher("https://api.kraken.com/0/public/PostTrade?symbol=ETH%2FUSD&count=10", {
    headers: { Accept: "application/json", "User-Agent": "Aurel/1.0 price-observations" }, signal: AbortSignal.timeout(8_000)
  });
  const parsed = responseSchema.parse(await boundedJson(response));
  if (parsed.error.length || parsed.result.count !== parsed.result.trades.length) throw new Error("Spot price source returned an incomplete observation.");
  const now = (dependencies.now ?? Date.now)();
  if (!Number.isFinite(now)) throw new Error("Spot price observation clock is unavailable.");
  const nowNs = BigInt(Math.trunc(now)) * 1_000_000n;
  const observed = parsed.result.trades.map((item) => {
    const time = sourceInstantNs(item.trade_ts);
    const publication = sourceInstantNs(item.publication_ts);
    if (time === null || publication === null || time > publication || publication > nowNs) throw new Error("Spot price source returned an invalid timestamp.");
    return { item, time };
  });
  const newest = observed.reduce((best, candidate) => candidate.time > best.time ? candidate : best);
  if (observed.filter((candidate) => candidate.time === newest.time).length !== 1) {
    throw new Error("Spot price source returned an ambiguous latest trade.");
  }
  if (sourceInstantNs(parsed.result.last_ts) !== newest.time) throw new Error("Spot price source returned an inconsistent cursor.");
  if (nowNs - newest.time > 300_000_000_000n) throw new Error("Spot price source is stale.");
  return {
    pairId: reviewed.pairId, baseAssetId: reviewed.baseAssetId, quoteAssetId: reviewed.quoteAssetId,
    quoteCurrency: "USD", mappingVersion: reviewed.mappingVersion, price: newest.item.price,
    sourceObservedAt: newest.item.trade_ts, fetchedAt: new Date(now).toISOString(),
    observationId: `kraken:${reviewed.pairId}:${newest.item.trade_id}`,
    mappingReviewed: true, assetEligible: true, depegged: false
  };
}
