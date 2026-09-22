import { z } from "zod";

export type MarketRow = {
  id: string;
  symbol: string;
  name: string;
  image: null;
  current_price: number;
  market_cap: null;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d: null;
  day_high: number;
  day_low: number;
  last_updated: string;
};

export type MarketHistory = { prices: Array<[number, number]> };

const tickerSchema = z.object({
  c: z.array(z.string()).min(1),
  v: z.array(z.string()).min(2),
  h: z.array(z.string()).min(2),
  l: z.array(z.string()).min(2),
  o: z.string()
});

const tickerResponseSchema = z.object({ error: z.array(z.string()), result: z.record(z.string(), tickerSchema) });
const ohlcResponseSchema = z.object({ error: z.array(z.string()), result: z.record(z.string(), z.unknown()) });
const api = "https://api.kraken.com/0/public";
const headers = { Accept: "application/json", "User-Agent": "Aurel/1.0 market-data" };
const names: Record<string, string> = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", XRP: "XRP", ADA: "Cardano", DOGE: "Dogecoin", AVAX: "Avalanche", DOT: "Polkadot", LINK: "Chainlink", LTC: "Litecoin", BCH: "Bitcoin Cash", UNI: "Uniswap", AAVE: "Aave", USDC: "USD Coin", USDT: "Tether" };
const historyPairs: Record<string, string> = { ethereum: "ETHUSD", "eth-ethereum": "ETHUSD", bitcoin: "BTCUSD", "btc-bitcoin": "BTCUSD" };

function number(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Market data provider returned an invalid number.");
  return parsed;
}

export async function getMarkets(page: number, perPage = 50): Promise<MarketRow[]> {
  const response = await fetch(`${api}/Ticker?assetVersion=1`, { headers, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Market data provider returned ${response.status}.`);
  const payload = tickerResponseSchema.parse(await response.json());
  if (payload.error.length) throw new Error(`Market data provider returned ${payload.error[0]}.`);
  const markets = Object.entries(payload.result).filter(([pair]) => pair.endsWith("/USD")).map(([pair, ticker]) => {
    const symbol = pair.slice(0, -4);
    const price = number(ticker.c[0]);
    const open = number(ticker.o);
    return {
      id: pair.toLowerCase().replace("/", "-"),
      symbol: symbol.toLowerCase(),
      name: names[symbol] ?? symbol,
      image: null,
      current_price: price,
      market_cap: null,
      market_cap_rank: 0,
      total_volume: number(ticker.v[1]) * price,
      price_change_percentage_24h: open ? ((price - open) / open) * 100 : 0,
      price_change_percentage_7d: null,
      day_high: number(ticker.h[1]),
      day_low: number(ticker.l[1]),
      last_updated: new Date().toISOString()
    } satisfies MarketRow;
  }).sort((a, b) => b.total_volume - a.total_volume).map((market, index) => ({ ...market, market_cap_rank: index + 1 }));
  const start = (page - 1) * perPage;
  return markets.slice(start, start + perPage);
}

export async function getMarketHistory(id: string, days: number): Promise<MarketHistory> {
  const safeId = z.string().regex(/^[a-z0-9-]{1,80}$/).parse(id);
  const pair = historyPairs[safeId];
  if (!pair) throw new Error("Historical data is not configured for this asset.");
  const safeDays = z.number().int().min(1).max(365).parse(days);
  const since = Math.floor(Date.now() / 1000) - safeDays * 86_400;
  const query = new URLSearchParams({ pair, assetVersion: "1", interval: "1440", since: String(since) });
  const response = await fetch(`${api}/OHLC?${query}`, { headers, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Market history provider returned ${response.status}.`);
  const payload = ohlcResponseSchema.parse(await response.json());
  if (payload.error.length) throw new Error(`Market history provider returned ${payload.error[0]}.`);
  const rows = Object.entries(payload.result).find(([key]) => key !== "last")?.[1];
  const candles = z.array(z.tuple([z.number(), z.string(), z.string(), z.string(), z.string(), z.string(), z.string(), z.number()])).parse(rows);
  return { prices: candles.map((candle) => [candle[0] * 1000, number(candle[4])]) };
}
