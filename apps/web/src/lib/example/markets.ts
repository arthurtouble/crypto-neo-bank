import type { Fill, OpenOrder, PerpAccountState, PerpMarket } from "@/lib/markets/hyperliquid/info";
import type { PolymarketEvent, PolymarketMarket } from "@/lib/markets/polymarket/markets";
import type { Position } from "@/lib/markets/polymarket/positions";
import type { Observed } from "@/lib/markets/types";
import { PERP_RANGES, type PerpRange } from "@/lib/markets/view";

/**
 * Fictional Markets data for guests, in the shapes `/api/perps/*` and
 * `/api/predictions/*` return. Prices, positions, and questions are made up
 * and every question says "(example)"; the page's guest banner says the rest.
 */
const at = "2026-01-15T12:00:00.000Z";
const time = Date.parse(at);
const owner = "0x000000000000000000000000000000000000e0a1";
const observed = <T>(source: "hyperliquid" | "polymarket", data: T): Observed<T> => ({ status: "observed", source, observedAt: at, data });

const perp = (coin: string, index: number, maxLeverage: number, markPx: string, prevDayPx: string, dayNtlVlm: string, openInterest: string, funding = "0.0000125"): PerpMarket => ({
  coin, dex: coin.includes(":") ? coin.split(":")[0] : "", assetIndex: index, szDecimals: 2, maxLeverage, markPx, midPx: markPx, oraclePx: markPx,
  prevDayPx, dayNtlVlm, funding, openInterest
});

export const examplePerpMarkets: Observed<PerpMarket[]> = observed("hyperliquid", [
  perp("BTC", 0, 40, "64250.0", "63110.0", "2140000000", "31250.5"),
  perp("ETH", 1, 25, "3120.4", "3175.9", "980000000", "412000.2"),
  perp("SOL", 5, 20, "148.62", "141.30", "310000000", "2650000"),
  perp("HYPE", 159, 10, "38.214", "37.100", "185000000", "9800000"),
  perp("xyz:SPCX", 110000, 10, "212.40", "208.75", "12400000", "48000"),
  perp("xyz:NVDA", 110001, 10, "131.05", "133.80", "8600000", "52000")
]);

const mainState: PerpAccountState = {
  dex: "", accountValue: "1286.40", totalMarginUsed: "321.30", withdrawable: "965.10", crossAccountValue: "1286.40", crossMaintenanceMarginUsed: "40.16", time,
  positions: [{ coin: "BTC", size: "0.05", entryPx: "62900.0", positionValue: "3212.50", unrealizedPnl: "67.50", returnOnEquity: "0.2146",
    liquidationPx: "50820.0", leverage: { type: "cross", value: 10 }, marginUsed: "321.25" }]
};
const stockState: PerpAccountState = {
  dex: "xyz", accountValue: "0", totalMarginUsed: "0", withdrawable: "0", crossAccountValue: "0", crossMaintenanceMarginUsed: "0", time, positions: []
};

const exampleOrders: OpenOrder[] = [
  { coin: "ETH", side: "buy", limitPx: "2950.0", size: "0.2", origSize: "0.2", oid: 1001, timestamp: time - 3_600_000, orderType: "Limit",
    reduceOnly: false, isTrigger: false, triggerPx: "0", isPositionTpsl: false, tif: "Gtc" },
  { coin: "BTC", side: "sell", limitPx: "70000.0", size: "0.05", origSize: "0.05", oid: 1002, timestamp: time - 7_200_000, orderType: "Take Profit Market",
    reduceOnly: true, isTrigger: true, triggerPx: "70000.0", isPositionTpsl: true, tif: null }
];

const exampleFills: Fill[] = [
  { coin: "BTC", px: "62900.0", size: "0.05", side: "buy", time: time - 86_400_000, dir: "Open Long", closedPnl: "0", fee: "1.41", feeToken: "USDC",
    oid: 990, tid: 1, hash: `0x${"0".repeat(63)}1` },
  { coin: "SOL", px: "151.20", size: "4", side: "sell", time: time - 2 * 86_400_000, dir: "Close Long", closedPnl: "18.40", fee: "0.27", feeToken: "USDC",
    oid: 980, tid: 2, hash: `0x${"0".repeat(63)}2` }
];

export const examplePerpsAccount = {
  owner,
  connection: { status: "ready" as const, tradingKey: "0x000000000000000000000000000000000000e0c3", approvedAt: at },
  state: observed("hyperliquid", mainState),
  dexStates: observed("hyperliquid", [mainState, stockState]),
  orders: observed("hyperliquid", exampleOrders),
  fills: observed("hyperliquid", exampleFills)
};

const token = (n: number) => `${n}`.padStart(12, "7");
const condition = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

function market(id: number, question: string, yes: number, extra: Partial<PolymarketMarket> = {}): PolymarketMarket {
  return {
    id: String(id), slug: `example-${id}`, conditionId: condition(id), question, eventId: String(id * 10), eventTitle: question, eventSlug: `example-${id}`,
    image: null, endDate: "2026-12-31T23:59:00.000Z", startTime: null, resolutionSource: "https://www.example.com/official-results",
    outcomes: [{ name: "Yes", tokenId: token(id * 2), price: yes }, { name: "No", tokenId: token(id * 2 + 1), price: Number((1 - yes).toFixed(3)) }],
    yesTokenId: token(id * 2), noTokenId: token(id * 2 + 1), volume: 1_850_000, volume24h: 92_000, liquidity: 140_000, bestBid: yes - 0.01, bestAsk: yes + 0.01,
    negRisk: false, tickSize: 0.01, minOrderSize: 5, closed: false, acceptingOrders: true, tags: [{ slug: "politics", label: "Politics" }], ...extra
  };
}

function event(id: number, title: string, markets: PolymarketMarket[], tags: Array<{ slug: string; label: string }>, extra: Partial<PolymarketEvent> = {}): PolymarketEvent {
  return {
    id: String(id * 10), slug: `example-event-${id}`, title, image: null, endDate: markets[0].endDate, startTime: null, resolutionSource: markets[0].resolutionSource,
    upOrDown: null, volume: markets.reduce((sum, item) => sum + (item.volume ?? 0), 0), volume24h: 120_000, liquidity: 200_000, negRisk: markets.length > 1, tags,
    markets: markets.map((item) => ({ ...item, tags })), ...extra
  };
}

const politics = [{ slug: "politics", label: "Politics" }];
const economy = [{ slug: "economy", label: "Economy" }];
const tech = [{ slug: "tech", label: "Tech" }];

export const examplePredictionEvents: PolymarketEvent[] = [
  event(101, "Will the city council pass the transit budget by March? (example)", [market(101, "Will the city council pass the transit budget by March? (example)", 0.63)], politics),
  event(102, "Central bank rate decision in June (example)", [
    market(102, "Rates cut in June? (example)", 0.41, { tags: economy }),
    market(103, "Rates unchanged in June? (example)", 0.52, { tags: economy }),
    market(104, "Rates raised in June? (example)", 0.07, { tags: economy })
  ], economy),
  event(105, "Will a phone maker ship a foldable under $500 this year? (example)", [market(105, "Will a phone maker ship a foldable under $500 this year? (example)", 0.28)], tech)
];

export const exampleUpOrDownEvents: PolymarketEvent[] = [
  event(201, "Bitcoin up or down, 3:00 to 3:15 PM (example)", [{ ...market(201, "Bitcoin up or down, 3:00 to 3:15 PM (example)", 0.54),
    outcomes: [{ name: "Up", tokenId: token(402), price: 0.54 }, { name: "Down", tokenId: token(403), price: 0.46 }], endDate: "2026-01-15T15:15:00.000Z" }],
  [{ slug: "up-or-down", label: "Up or Down" }, { slug: "15M", label: "15M" }], { upOrDown: { window: "15M", priceToBeat: 64210.5 }, endDate: "2026-01-15T15:15:00.000Z" }),
  event(202, "Ethereum up or down, 3:00 to 4:00 PM (example)", [{ ...market(202, "Ethereum up or down, 3:00 to 4:00 PM (example)", 0.47),
    outcomes: [{ name: "Up", tokenId: token(404), price: 0.47 }, { name: "Down", tokenId: token(405), price: 0.53 }], endDate: "2026-01-15T16:00:00.000Z" }],
  [{ slug: "up-or-down", label: "Up or Down" }, { slug: "1H", label: "1H" }], { upOrDown: { window: "1H", priceToBeat: 3118.2 }, endDate: "2026-01-15T16:00:00.000Z" })
];

/** One example market by id: the matching example, or the first. */
export function examplePredictionMarket(id: string) {
  const all = [...examplePredictionEvents, ...exampleUpOrDownEvents].flatMap((item) => item.markets);
  const found = all.find((item) => item.id === id) ?? all[0];
  return { market: found, quotes: null, observedAt: at };
}

const exampleMark = (coin: string) => {
  const found = examplePerpMarkets.status === "observed" ? examplePerpMarkets.data.find((item) => item.coin === coin) : undefined;
  return Number(found?.markPx ?? "100");
};
const priceText = (value: number) => value.toFixed(value >= 1_000 ? 1 : value >= 10 ? 2 : 4);

/** Example candles for a perp's chart: a wave that ends at the example price. */
export function examplePerpCandles(coin: string, range: PerpRange) {
  const { intervalMs, count } = PERP_RANGES.find((item) => item.value === range) ?? PERP_RANGES[2];
  const mark = exampleMark(coin);
  const swing = mark * 0.004 * Math.sqrt(intervalMs / 60_000) / 4;
  const level = (index: number) => mark + swing * (6 * Math.sin(index / 9) + 3 * Math.sin(index / 3.7) - 6 * Math.sin((count - 1) / 9) - 3 * Math.sin((count - 1) / 3.7));
  const candles = Array.from({ length: count }, (_, index) => {
    const open = level(index - 1), close = level(index);
    const wick = swing * (0.6 + 0.4 * Math.abs(Math.sin(index * 1.7)));
    return { t: time - (count - 1 - index) * intervalMs, o: priceText(open), c: priceText(close), h: priceText(Math.max(open, close) + wick),
      l: priceText(Math.min(open, close) - wick), v: (1_000 + 400 * Math.abs(Math.sin(index))).toFixed(2) };
  });
  return { status: "observed" as const, source: "hyperliquid" as const, observedAt: at, coin, interval: "1m", candles };
}

/** An example order book around the example price, 20 levels a side. */
export function examplePerpBook(coin: string) {
  const mark = exampleMark(coin);
  const tick = mark >= 10_000 ? 1 : mark >= 1_000 ? 0.1 : mark >= 10 ? 0.01 : 0.001;
  const size = (index: number) => ((2 + 3 * Math.abs(Math.sin(index * 2.3)) + index * 0.4) * 1_000 / mark).toPrecision(4);
  const level = (side: 1 | -1) => (_: unknown, index: number) => ({ price: priceText(mark + side * tick * (index + 1)), size: size(index + (side > 0 ? 7 : 0)), orders: 1 + (index % 4) });
  const bids = Array.from({ length: 20 }, level(-1)), asks = Array.from({ length: 20 }, level(1));
  const spread = Number(asks[0].price) - Number(bids[0].price);
  return { status: "observed" as const, source: "hyperliquid" as const, observedAt: at, coin, bids, asks,
    spread: String(Number(spread.toPrecision(8))), spreadPercent: (spread / mark * 100).toFixed(4) };
}

/** A gently moving example line for the odds chart. */
export function examplePredictionHistory(interval: string) {
  const points = 48;
  const span = { "1d": 86_400, "1w": 604_800, "1m": 2_592_000, max: 7_776_000 }[interval] ?? 604_800;
  const end = Math.floor(time / 1000);
  return Array.from({ length: points }, (_, index) => ({
    time: end - span + Math.round((span / (points - 1)) * index),
    price: Number((0.5 + 0.12 * Math.sin(index / 6) + index * 0.0025).toFixed(3))
  }));
}

const examplePositions: Position[] = [
  { tokenId: token(202), oppositeTokenId: token(203), conditionId: condition(101), title: "Will the city council pass the transit budget by March? (example)",
    slug: "example-101", eventSlug: "example-event-101", icon: null, outcome: "Yes", outcomeIndex: 0, size: 40, avgPrice: 0.55, currentPrice: 0.63, value: 25.2,
    cost: 22, pnl: 3.2, percentPnl: 14.55, realizedPnl: null, redeemable: false, negRisk: false, endDate: "2026-12-31T23:59:00.000Z" }
];

export const examplePredictionsAccount = {
  owner,
  connection: { status: "ready" as const, wallet: "0x000000000000000000000000000000000000e0d4", approvedAt: at },
  balance: observed("polymarket", { raw: "74800000", amount: "74.8" }),
  positions: observed("polymarket", examplePositions),
  orders: observed("polymarket", [])
};
