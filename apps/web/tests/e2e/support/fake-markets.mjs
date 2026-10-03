// Read-only fakes of the venues behind Markets: Hyperliquid's info API
// (markets, a customer's account, orders, fills) and Polymarket's Gamma,
// CLOB, and Data APIs (events, one market, prices, odds history,
// positions). Aura's own API routes read them for real; specs that drive a
// trade end to end stub Aura's write routes in the browser instead, since
// signing at the venues needs keys the fake doesn't hold.
//
// Tests change them through /__markets: { hyperliquid: { [address or "address:dex"]: account }, positions: [...] }.
// "hyperliquid" and "polymarket" in `down` make them fail.

const DAY_AGO = Date.now() - 86_400_000;

/** Markets per dex: the main dex and the "xyz" stock dex, as Hyperliquid lists them. */
const DEXES = [
  { universe: [
    { name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "ETH", szDecimals: 4, maxLeverage: 25 }, { name: "SOL", szDecimals: 2, maxLeverage: 20 }
  ], ctxs: [
    { markPx: "64250.0", midPx: "64250.5", oraclePx: "64240.0", prevDayPx: "63110.0", dayNtlVlm: "2140000000.0", funding: "0.0000125", openInterest: "31250.5" },
    { markPx: "3120.4", midPx: "3120.5", oraclePx: "3119.8", prevDayPx: "3175.9", dayNtlVlm: "980000000.0", funding: "0.0000100", openInterest: "412000.2" },
    { markPx: "148.62", midPx: "148.63", oraclePx: "148.60", prevDayPx: "141.30", dayNtlVlm: "310000000.0", funding: "-0.0000040", openInterest: "2650000.0" }
  ] },
  { universe: [
    { name: "xyz:SPCX", szDecimals: 2, maxLeverage: 10 }, { name: "xyz:NVDA", szDecimals: 2, maxLeverage: 10, onlyIsolated: true }
  ], ctxs: [
    { markPx: "212.40", midPx: "212.41", oraclePx: "212.35", prevDayPx: "208.75", dayNtlVlm: "12400000.0", funding: "0.0000080", openInterest: "48000.0" },
    { markPx: "131.05", midPx: "131.06", oraclePx: "131.00", prevDayPx: "133.80", dayNtlVlm: "8600000.0", funding: "0.0000050", openInterest: "52000.0" }
  ] }
];

const conditionId = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const token = (n) => `${n}`.padStart(20, "9");

function gammaMarket(id, question, yes, extra = {}) {
  return {
    id: String(id), question, conditionId: conditionId(id), slug: `market-${id}`, endDate: "2026-12-31T23:59:00Z", resolutionSource: "https://www.example.com/results",
    outcomes: JSON.stringify(extra.names ?? ["Yes", "No"]), outcomePrices: JSON.stringify([String(yes), String(Number((1 - yes).toFixed(3)))]),
    clobTokenIds: JSON.stringify([token(id * 2), token(id * 2 + 1)]), volumeNum: 2_500_000, volume24hr: 125_000, liquidityNum: 300_000,
    negRisk: false, orderPriceMinTickSize: 0.01, orderMinSize: 5, active: true, closed: false, archived: false, acceptingOrders: true, enableOrderBook: true,
    bestBid: yes - 0.01, bestAsk: yes + 0.01, tags: [], ...extra.market
  };
}

const TAGS = { politics: { id: "2", slug: "politics", label: "Politics" }, economy: { id: "100328", slug: "economy", label: "Economy" },
  crypto: { id: "21", slug: "crypto", label: "Crypto" }, upOrDown: { id: "102127", slug: "up-or-down", label: "Up or Down" }, window: { id: "102467", slug: "15M", label: "15M" },
  sports: { id: "1", slug: "sports", label: "Sports" } };

function gammaEvent(id, title, markets, tags, extra = {}) {
  return { id: String(id), title, slug: `event-${id}`, endDate: markets[0].endDate, startTime: null, resolutionSource: markets[0].resolutionSource,
    volume: 5_100_000, volume24hr: 240_000, liquidity: 410_000, negRisk: markets.length > 1, closed: false, archived: false, tags, markets, ...extra };
}

export function initialMarkets() {
  const events = [
    gammaEvent(5001, "Will the transit budget pass by March?", [gammaMarket(5001, "Will the transit budget pass by March?", 0.63)], [TAGS.politics]),
    gammaEvent(5002, "Rate decision in June", [gammaMarket(5002, "Rates cut in June?", 0.41), gammaMarket(5003, "Rates unchanged in June?", 0.52)], [TAGS.economy]),
    gammaEvent(5004, "Will ether close the year above $4,000?", [gammaMarket(5004, "Will ether close the year above $4,000?", 0.37)], [TAGS.crypto]),
    // Sports is never listed: Aura filters it out even when Polymarket returns it.
    gammaEvent(5005, "Who wins the cup final?", [gammaMarket(5005, "Will the home team win the cup final?", 0.5)], [TAGS.sports])
  ];
  const upOrDown = [gammaEvent(6001, "Bitcoin Up or Down - 3:00PM-3:15PM ET", [gammaMarket(6001, "Bitcoin Up or Down - 3:00PM-3:15PM ET", 0.54,
    { names: ["Up", "Down"], market: { endDate: new Date(Date.now() + 900_000).toISOString() } })], [TAGS.upOrDown, TAGS.window, TAGS.crypto],
    { endDate: new Date(Date.now() + 900_000).toISOString(), eventMetadata: { priceToBeat: 64210.5 } })];
  return { hyperliquid: { accounts: {} }, polymarket: { events, upOrDown, positions: [] } };
}

const emptyAccount = { accountValue: "0", withdrawable: "0", positions: [], orders: [], fills: [] };

function clearinghouse(account) {
  const used = account.positions.reduce((sum, item) => sum + Number(item.marginUsed), 0);
  return {
    marginSummary: { accountValue: account.accountValue, totalMarginUsed: String(used) },
    crossMarginSummary: { accountValue: account.accountValue },
    crossMaintenanceMarginUsed: String(used / 2), withdrawable: account.withdrawable, time: Date.now(),
    assetPositions: account.positions.map((position) => ({ type: "oneWay", position }))
  };
}

/** Hyperliquid's POST /info, for the reads Aura makes. */
function hyperliquidInfo(markets, body) {
  const user = String(body.user ?? "").toLowerCase();
  const dex = body.dex ?? "";
  const accounts = markets.hyperliquid.accounts;
  const account = { ...emptyAccount, ...(dex ? accounts[`${user}:${dex}`] : accounts[user]) };
  switch (body.type) {
    case "allPerpMetas": return DEXES.map((item) => ({ universe: item.universe, collateralToken: 0 }));
    case "metaAndAssetCtxs": {
      const found = DEXES[dex === "xyz" ? 1 : 0];
      return [{ universe: found.universe }, found.ctxs];
    }
    case "clearinghouseState": return clearinghouse(account);
    case "frontendOpenOrders": return account.orders;
    case "userFills": return account.fills;
    case "allMids": return Object.fromEntries(DEXES[dex === "xyz" ? 1 : 0].universe.map((asset, index) => [asset.name, DEXES[dex === "xyz" ? 1 : 0].ctxs[index].midPx]));
    case "candleSnapshot": return candleSnapshot(body.req ?? {});
    case "l2Book": markets.hyperliquid.bookReads = (markets.hyperliquid.bookReads ?? 0) + 1; return l2Book(String(body.coin ?? ""), markets.hyperliquid.bookReads);
    case "userFees": return { userCrossRate: "0.00045", userAddRate: "0.00015", activeReferralDiscount: "0.0" };
    default: return null;
  }
}

const INTERVAL_MS = { "1m": 60_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "12h": 43_200_000, "1d": 86_400_000, "1w": 604_800_000 };

/** A market's mid price in the fake, or null for a coin Hyperliquid doesn't list. */
function midOf(coin) {
  for (const item of DEXES) {
    const index = item.universe.findIndex((asset) => asset.name === coin);
    if (index !== -1) return Number(item.ctxs[index].midPx);
  }
  return null;
}

const px = (value) => value.toFixed(value >= 1_000 ? 1 : value >= 10 ? 2 : 4);

/** Hyperliquid's candleSnapshot: a wave of candles over the requested span that ends at the mid price. At most 400. */
function candleSnapshot({ coin, interval, startTime, endTime }) {
  const mid = midOf(coin);
  const step = INTERVAL_MS[interval];
  if (mid === null || !step) return [];
  const end = Math.floor(Number(endTime ?? Date.now()) / step) * step;
  const count = Math.max(2, Math.min(400, Math.floor((end - Math.max(Number(startTime ?? 0), end - 400 * step)) / step) + 1));
  const swing = mid * 0.001 * Math.sqrt(step / 60_000);
  const level = (index) => mid + swing * (Math.sin(index / 9) - Math.sin((count - 1) / 9) + 0.5 * (Math.sin(index / 3.3) - Math.sin((count - 1) / 3.3)));
  return Array.from({ length: count }, (_, index) => {
    const open = level(index - 1), close = level(index), wick = swing * 0.4;
    const t = end - (count - 1 - index) * step;
    return { t, T: t + step - 1, s: coin, i: interval, o: px(open), c: px(close), h: px(Math.max(open, close) + wick), l: px(Math.min(open, close) - wick), v: "12.5", n: 40 };
  });
}

/** Hyperliquid's l2Book: 20 levels a side around the mid price, one tick apart; `ticks` shifts the sizes so each read differs. */
function l2Book(coin, ticks) {
  const mid = midOf(coin);
  if (mid === null) return null;
  const tick = mid >= 10_000 ? 1 : mid >= 1_000 ? 0.1 : 0.01;
  const level = (side) => (_, index) => ({ px: px(mid + side * tick * (index + 0.5)), sz: ((1 + index * 0.35 + ((index + ticks) % 3) * 0.2) * 1_000 / mid).toPrecision(4), n: 1 + (index % 4) });
  return { coin, time: Date.now(), levels: [Array.from({ length: 20 }, level(-1)), Array.from({ length: 20 }, level(1))] };
}

const allMarkets = (markets) => [...markets.polymarket.events, ...markets.polymarket.upOrDown].flatMap((event) =>
  event.markets.map((market) => ({ ...market, events: [{ id: event.id, title: event.title, slug: event.slug, tags: event.tags }] })));

/**
 * Answer a Markets request, or return false when the path isn't one of these fakes.
 * `send(status, payload)` writes the response.
 */
export function handleMarkets({ url, method, body, state, send }) {
  const markets = state.markets;
  const down = (name) => state.down.includes(name);
  // Test control: give a Hyperliquid account ("address" or "address:dex") or Polymarket positions.
  if (url.pathname === "/__markets") {
    Object.assign(markets.hyperliquid.accounts, Object.fromEntries(Object.entries(body?.hyperliquid ?? {}).map(([key, value]) => [key.toLowerCase(), value])));
    if (body?.positions) markets.polymarket.positions = body.positions;
    return send(200, { ok: true }), true;
  }
  if (url.pathname === "/hyperliquid/info" && method === "POST") {
    if (down("hyperliquid")) return send(503, { error: "unavailable" }), true;
    const answer = hyperliquidInfo(markets, body ?? {});
    return answer === null ? send(422, "Failed to deserialize the JSON body") : send(200, answer), true;
  }
  if (!url.pathname.startsWith("/polymarket/")) return false;
  if (down("polymarket")) return send(503, { error: "unavailable" }), true;
  const path = url.pathname.slice("/polymarket".length);
  if (path === "/gamma/events/keyset") {
    const tag = url.searchParams.get("tag_slug");
    const list = tag === "up-or-down" ? markets.polymarket.upOrDown
      : markets.polymarket.events.filter((event) => !tag || event.tags.some((item) => item.slug === tag));
    return send(200, { events: list, next_cursor: null }), true;
  }
  const marketRef = /^\/gamma\/markets\/(?:slug\/)?([\w-]+)$/.exec(path);
  if (marketRef) {
    const found = allMarkets(markets).find((item) => item.id === marketRef[1] || item.slug === marketRef[1]);
    return found ? send(200, found) : send(404, { error: "not found" }), true;
  }
  if (path === "/clob/midpoints" && method === "POST") {
    const prices = Object.fromEntries(allMarkets(markets).flatMap((market) => {
      const [yes, no] = JSON.parse(market.clobTokenIds), [py, pn] = JSON.parse(market.outcomePrices);
      return [[yes, py], [no, pn]];
    }));
    return send(200, Object.fromEntries((body ?? []).map((item) => [item.token_id, prices[item.token_id] ?? "0.5"]))), true;
  }
  if (path === "/clob/prices" && method === "POST") {
    const prices = Object.fromEntries(allMarkets(markets).flatMap((market) => {
      const [yes, no] = JSON.parse(market.clobTokenIds), [py, pn] = JSON.parse(market.outcomePrices).map(Number);
      return [[yes, py], [no, pn]];
    }));
    const answer = {};
    for (const item of body ?? []) {
      const mid = prices[item.token_id] ?? 0.5;
      answer[item.token_id] = { ...answer[item.token_id], [item.side]: (item.side === "BUY" ? mid - 0.01 : mid + 0.01).toFixed(2) };
    }
    return send(200, answer), true;
  }
  if (path === "/clob/prices-history") {
    const now = Math.floor(Date.now() / 1000);
    return send(200, { history: Array.from({ length: 40 }, (_, index) => ({ t: now - (40 - index) * 3600, p: Number((0.45 + 0.15 * Math.sin(index / 5) + index * 0.002).toFixed(3)) })) }), true;
  }
  if (path === "/data/v2/positions") return send(200, { data: markets.polymarket.positions, pagination: { has_more: false } }), true;
  return send(404, { error: `no fake for ${url.pathname}` }), true;
}

/** Hyperliquid's signed account size for a position, with the fields Aura reads. */
export function perpPosition({ coin, size, entryPx, positionValue, unrealizedPnl, leverage = 10, liquidationPx = null, marginUsed }) {
  return { coin, szi: size, entryPx, positionValue, unrealizedPnl, returnOnEquity: String(Number(unrealizedPnl) / Number(marginUsed)),
    liquidationPx, leverage: { type: "cross", value: leverage }, marginUsed, maxLeverage: 40, cumFunding: { allTime: "0", sinceOpen: "0", sinceChange: "0" } };
}

/** A Polymarket Data API position for the fake's market `id`. */
export function predictionPosition({ id, title = `Market ${id}`, outcomeIndex = 0, size, avgPrice, currentPrice, redeemable = false }) {
  return { token_id: token(id * 2 + outcomeIndex), opposite_token_id: token(id * 2 + 1 - outcomeIndex), condition_id: conditionId(id), title,
    slug: `market-${id}`, event_slug: `event-${id}`, icon: null, outcome: outcomeIndex === 0 ? "Yes" : "No", outcome_index: outcomeIndex,
    current_size: size, avg_price: avgPrice, current_price: currentPrice, current_value: size * currentPrice, entry_cost_usdc: size * avgPrice,
    total_pnl: size * (currentPrice - avgPrice), percent_pnl: ((currentPrice - avgPrice) / avgPrice) * 100, realized_pnl: 0, redeemable, negative_risk: false, end_date: "2026-12-31T23:59:00Z" };
}

export const FAKE_FILL_TIME = DAY_AGO;
