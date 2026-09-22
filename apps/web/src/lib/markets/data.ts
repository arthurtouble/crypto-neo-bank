import { z } from "zod";

const marketRowSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  image: z.string().url(),
  current_price: z.number().nullable(),
  market_cap: z.number().nullable(),
  market_cap_rank: z.number().nullable(),
  total_volume: z.number().nullable(),
  price_change_percentage_24h: z.number().nullable(),
  sparkline_in_7d: z.object({ price: z.array(z.number()) }).optional(),
  last_updated: z.string()
});

const historySchema = z.object({
  prices: z.array(z.tuple([z.number(), z.number()])),
  market_caps: z.array(z.tuple([z.number(), z.number()])).optional(),
  total_volumes: z.array(z.tuple([z.number(), z.number()])).optional()
});

export type MarketRow = z.infer<typeof marketRowSchema>;
export type MarketHistory = z.infer<typeof historySchema>;

const api = "https://api.coingecko.com/api/v3";
const headers = { Accept: "application/json", "User-Agent": "Aurel/1.0 market-data" };

export async function getMarkets(page: number, perPage = 50) {
  const query = new URLSearchParams({
    vs_currency: "usd",
    order: "market_cap_desc",
    per_page: String(perPage),
    page: String(page),
    sparkline: "true",
    price_change_percentage: "24h",
    include_rehypothecated: "true",
    precision: "full"
  });
  const response = await fetch(`${api}/coins/markets?${query}`, { headers, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Market data provider returned ${response.status}.`);
  return z.array(marketRowSchema).parse(await response.json());
}

export async function getMarketHistory(id: string, days: number) {
  const safeId = z.string().regex(/^[a-z0-9-]{1,80}$/).parse(id);
  const safeDays = z.number().int().min(1).max(365).parse(days);
  const query = new URLSearchParams({ vs_currency: "usd", days: String(safeDays), precision: "full" });
  const response = await fetch(`${api}/coins/${safeId}/market_chart?${query}`, { headers, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Market history provider returned ${response.status}.`);
  return historySchema.parse(await response.json());
}
