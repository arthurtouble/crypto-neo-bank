import { z } from "zod";
import { VenueError } from "../types";
import { numeric, polymarketRequest, type RequestOptions } from "./http";

/**
 * Public market data: Gamma for discovery, the CLOB for books and the exact
 * trading parameters (tick size, neg risk, fees). Sports markets are never
 * shown or traded through Aura (a product decision), so every read drops them,
 * first through Gamma's own tag filter and then by checking each item here.
 */

export const TICK_SIZES = [0.1, 0.01, 0.005, 0.0025, 0.001, 0.0001] as const;
export type TickSize = (typeof TICK_SIZES)[number];

/**
 * How sports and esports are excluded (checked live, October 2026):
 * 1. Gamma drops events tagged "Sports" (id 1) server side (`exclude_tag_id`).
 * 2. Esports events usually carry tag 1 too, but not always (Valve, streamer,
 *    and "sport"-tagged items do not), so each event and market is checked
 *    again here by `isSports`: tag ids 1 and 64, the slugs sports, sport,
 *    and esports, a `gameId`, a `sportsMarketType`, or team ids. The video
 *    games tag ("games") alone is kept: it also covers culture markets.
 */
export const SPORTS_TAG_ID = "1";
/** Gamma's "Esports" tag. */
export const ESPORTS_TAG_ID = "64";
const SPORTS_TAG_SLUGS = new Set(["sports", "sport", "esports"]);
/** Gamma's tag on short-term crypto "Up or Down" events. */
export const UP_OR_DOWN_TAG = "up-or-down";

const tickSize = numeric.pipe(z.number().refine((value): value is TickSize => (TICK_SIZES as readonly number[]).includes(value)))
  .transform((value) => value as TickSize);
const id = z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()]).transform(String);
const text = z.string().max(2_000);
const optionalText = text.nullish().transform((value) => value || null);
const tag = z.object({ id, slug: z.string().max(200).nullish(), label: z.string().max(200).nullish() });
const tags = z.array(z.unknown()).nullish().transform((items) => (items ?? []).flatMap((item) => {
  const parsed = tag.safeParse(item);
  return parsed.success ? [{ id: parsed.data.id, slug: parsed.data.slug ?? "", label: parsed.data.label ?? "" }] : [];
}));
const gameId = z.union([z.string(), z.number()]).nullish();
/** Gamma encodes outcome lists as JSON inside a string. */
const jsonStringArray = z.string().max(20_000).transform((value, context) => {
  try {
    const parsed = z.array(z.union([z.string(), z.number()]).transform(String)).safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch { /* reported below */ }
  context.addIssue({ code: "custom", message: "Expected a JSON string array." });
  return z.NEVER;
});

const gammaMarket = z.object({
  id,
  question: text,
  conditionId: z.string().regex(/^0x[\da-fA-F]{64}$/),
  slug: z.string().max(300),
  endDate: optionalText,
  eventStartTime: optionalText,
  resolutionSource: optionalText,
  image: optionalText,
  icon: optionalText,
  outcomes: jsonStringArray,
  outcomePrices: jsonStringArray.nullish(),
  clobTokenIds: jsonStringArray,
  volumeNum: numeric.nullish(),
  volume: numeric.nullish(),
  volume24hr: numeric.nullish(),
  liquidityNum: numeric.nullish(),
  liquidity: numeric.nullish(),
  negRisk: z.boolean().nullish(),
  orderPriceMinTickSize: tickSize.nullish(),
  orderMinSize: numeric.nullish(),
  active: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  archived: z.boolean().nullish(),
  acceptingOrders: z.boolean().nullish(),
  enableOrderBook: z.boolean().nullish(),
  bestBid: numeric.nullish(),
  bestAsk: numeric.nullish(),
  gameId,
  sportsMarketType: z.string().max(200).nullish(),
  teamAID: z.string().max(200).nullish(),
  teamBID: z.string().max(200).nullish(),
  tags,
  events: z.array(z.object({ id, title: optionalText, slug: optionalText, image: optionalText, tags }).passthrough()).nullish()
});
type GammaMarket = z.output<typeof gammaMarket>;

const gammaEvent = z.object({
  id,
  title: text,
  slug: z.string().max(300),
  image: optionalText,
  endDate: optionalText,
  startTime: optionalText,
  resolutionSource: optionalText,
  eventMetadata: z.object({ priceToBeat: numeric.nullish() }).passthrough().nullish().catch(null),
  volume: numeric.nullish(),
  volume24hr: numeric.nullish(),
  liquidity: numeric.nullish(),
  negRisk: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  archived: z.boolean().nullish(),
  gameId,
  tags,
  markets: z.array(z.unknown()).nullish()
});
type GammaEvent = z.output<typeof gammaEvent>;

type SportsSignals = {
  tags?: Array<{ id: string; slug: string }>;
  gameId?: string | number | null;
  sportsMarketType?: string | null;
  teamAID?: string | null;
  teamBID?: string | null;
};

/**
 * Whether Gamma marks something as sports: the Sports or esports tags, a
 * game it is attached to, a sports market type (moneyline, spreads, totals),
 * or teams. Any one signal is enough; a false positive only hides a market.
 */
export function isSports(item: SportsSignals): boolean {
  if (item.tags?.some((entry) => entry.id === SPORTS_TAG_ID || entry.id === ESPORTS_TAG_ID || SPORTS_TAG_SLUGS.has(entry.slug.toLowerCase()))) return true;
  return [item.gameId, item.sportsMarketType, item.teamAID, item.teamBID].some((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

export type PolymarketOutcome = { name: string; tokenId: string; price: number | null };

export type PolymarketMarket = {
  id: string;
  slug: string;
  conditionId: `0x${string}`;
  question: string;
  eventId: string | null;
  eventTitle: string | null;
  eventSlug: string | null;
  image: string | null;
  /** When the market closes for trading; it resolves after, per `resolutionSource`. */
  endDate: string | null;
  /** The start of the measured window, for timed markets such as crypto Up or Down. */
  startTime: string | null;
  resolutionSource: string | null;
  /** Index 0 is "Yes" (or the first named side), index 1 is "No". */
  outcomes: [PolymarketOutcome, PolymarketOutcome];
  yesTokenId: string;
  noTokenId: string;
  volume: number | null;
  volume24h: number | null;
  liquidity: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  negRisk: boolean;
  tickSize: TickSize;
  minOrderSize: number;
  closed: boolean;
  acceptingOrders: boolean;
  tags: Array<{ slug: string; label: string }>;
};

export type PolymarketEvent = {
  id: string;
  slug: string;
  title: string;
  image: string | null;
  endDate: string | null;
  startTime: string | null;
  resolutionSource: string | null;
  /**
   * For a short-term crypto "Up or Down" event: its window (Gamma's `5M`,
   * `15M`, `1H`, `4H`, … tag) and the price to beat once the window has
   * started (Gamma's `eventMetadata.priceToBeat`; null before then).
   */
  upOrDown: { window: string | null; priceToBeat: number | null } | null;
  volume: number | null;
  volume24h: number | null;
  liquidity: number | null;
  negRisk: boolean;
  tags: Array<{ slug: string; label: string }>;
  markets: PolymarketMarket[];
};

const tokenId = /^\d{1,78}$/;
const price = (value: string | undefined) => {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
};

/** A binary, order-book market, or null when Gamma's data cannot be traded on. */
function normalizeMarket(market: GammaMarket, event: { id: string; title: string | null; slug: string | null; image: string | null; tags: GammaEvent["tags"] } | null): PolymarketMarket | null {
  const [yes, no] = market.clobTokenIds;
  if (market.clobTokenIds.length !== 2 || market.outcomes.length !== 2 || !yes || !no || !tokenId.test(yes) || !tokenId.test(no)) return null;
  if (!market.orderPriceMinTickSize || market.enableOrderBook === false) return null;
  const allTags = [...market.tags, ...(event?.tags ?? [])];
  const seen = new Set<string>();
  const uniqueTags = allTags.filter((entry) => !seen.has(entry.id) && seen.add(entry.id)).map(({ slug, label }) => ({ slug, label }));
  return {
    id: market.id,
    slug: market.slug,
    conditionId: market.conditionId.toLowerCase() as `0x${string}`,
    question: market.question,
    eventId: event?.id ?? null,
    eventTitle: event?.title ?? null,
    eventSlug: event?.slug ?? null,
    image: market.image ?? market.icon ?? event?.image ?? null,
    endDate: market.endDate,
    startTime: market.eventStartTime,
    resolutionSource: market.resolutionSource,
    outcomes: [
      { name: market.outcomes[0] ?? "Yes", tokenId: yes, price: price(market.outcomePrices?.[0]) },
      { name: market.outcomes[1] ?? "No", tokenId: no, price: price(market.outcomePrices?.[1]) }
    ],
    yesTokenId: yes,
    noTokenId: no,
    volume: market.volumeNum ?? market.volume ?? null,
    volume24h: market.volume24hr ?? null,
    liquidity: market.liquidityNum ?? market.liquidity ?? null,
    bestBid: market.bestBid ?? null,
    bestAsk: market.bestAsk ?? null,
    negRisk: market.negRisk === true,
    tickSize: market.orderPriceMinTickSize,
    minOrderSize: market.orderMinSize ?? 0,
    closed: market.closed === true,
    acceptingOrders: market.acceptingOrders === true,
    tags: uniqueTags
  };
}

/** Open, tradeable, and not sports. */
function listable(market: GammaMarket, eventTags: GammaEvent["tags"]): boolean {
  return market.active !== false && market.closed !== true && market.archived !== true && market.acceptingOrders === true
    && !isSports({ ...market, tags: [...market.tags, ...eventTags] });
}

const NAMED_WINDOWS: Record<string, string> = { hourly: "1H", daily: "1D", weekly: "1W" };
/** Gamma tags a window as `5M`, `15M`, `1H`, `4h`, or by name (`daily`); returned as `5M`, `4H`, `1D`, …. */
function upOrDownWindow(eventTags: Array<{ slug: string }>): string | null {
  for (const entry of eventTags) {
    const slug = entry.slug.toLowerCase();
    if (/^\d{1,3}[mhdw]$/.test(slug)) return slug.toUpperCase();
    if (NAMED_WINDOWS[slug]) return NAMED_WINDOWS[slug];
  }
  return null;
}

export function normalizeEvent(raw: unknown): PolymarketEvent | null {
  const parsed = gammaEvent.safeParse(raw);
  if (!parsed.success) return null;
  const event = parsed.data;
  if (event.closed === true || event.archived === true || isSports(event)) return null;
  const context = { id: event.id, title: event.title, slug: event.slug, image: event.image, tags: event.tags };
  const markets = (event.markets ?? []).flatMap((item) => {
    const market = gammaMarket.safeParse(item);
    if (!market.success || !listable(market.data, event.tags)) return [];
    const normalized = normalizeMarket(market.data, context);
    return normalized ? [normalized] : [];
  });
  if (markets.length === 0) return null;
  return {
    id: event.id, slug: event.slug, title: event.title, image: event.image, endDate: event.endDate,
    startTime: event.startTime, resolutionSource: event.resolutionSource ?? markets[0]?.resolutionSource ?? null,
    upOrDown: event.tags.some((entry) => entry.slug === UP_OR_DOWN_TAG)
      ? { window: upOrDownWindow(event.tags), priceToBeat: event.eventMetadata?.priceToBeat ?? null }
      : null,
    volume: event.volume ?? null, volume24h: event.volume24hr ?? null, liquidity: event.liquidity ?? null,
    negRisk: event.negRisk === true, tags: event.tags.map(({ slug, label }) => ({ slug, label })), markets
  };
}

/** A market's Up or Down window from its own and its event's tags, or null when it isn't one. The price to beat is read separately. */
export function marketUpOrDown(market: Pick<PolymarketMarket, "tags">): { window: string | null; priceToBeat: number | null } | null {
  return market.tags.some((entry) => entry.slug === UP_OR_DOWN_TAG) ? { window: upOrDownWindow(market.tags), priceToBeat: null } : null;
}

/**
 * An Up or Down window with its price to beat filled in while it runs, from
 * `upOrDownPriceToBeat`. Best effort: a failed read leaves it null, which
 * screens show as unavailable.
 */
export async function withPriceToBeat<T extends Pick<PolymarketEvent, "startTime" | "endDate" | "resolutionSource" | "upOrDown">>(event: T, options: RequestOptions = {}): Promise<T> {
  if (!event.upOrDown || event.upOrDown.priceToBeat !== null) return event;
  // A window that hasn't started has no price to beat yet.
  if (!event.startTime || !(new Date(event.startTime).getTime() <= Date.now())) return event;
  const read = await upOrDownPriceToBeat(event, options).catch(() => null);
  return read?.priceToBeat == null ? event : { ...event, upOrDown: { ...event.upOrDown, priceToBeat: read.priceToBeat } };
}

export type ListEventsInput = {
  search?: string;
  /** A Gamma tag slug such as "politics" or "crypto". */
  category?: string;
  sort?: "volume" | "ending_soon";
  limit?: number;
  cursor?: string;
  now?: Date;
};

const keysetPage = z.object({ events: z.array(z.unknown()), next_cursor: z.string().max(2_000).nullish() });

/**
 * Active, open, non-sports events with their tradeable binary markets, newest
 * page first. Gamma pages by an opaque cursor; pass `nextCursor` back as is.
 */
export async function listEvents(input: ListEventsInput = {}, options: RequestOptions = {}): Promise<{ events: PolymarketEvent[]; nextCursor: string | null }> {
  const search = input.search?.trim();
  if (search !== undefined && search.length > 100) throw new VenueError("polymarket", "invalid_request", "Search is too long.", 400);
  if (input.category !== undefined && !/^[a-z\d-]{1,60}$/i.test(input.category)) throw new VenueError("polymarket", "invalid_request", "Unknown category.", 400);
  if (input.cursor !== undefined && !/^[\w=-]{1,2000}$/.test(input.cursor)) throw new VenueError("polymarket", "invalid_request", "Invalid page.", 400);
  if (input.category && SPORTS_TAG_SLUGS.has(input.category.toLowerCase())) return { events: [], nextCursor: null };
  const endingSoon = input.sort === "ending_soon";
  const page = await polymarketRequest({
    service: "gamma",
    path: "/events/keyset",
    query: {
      active: true, closed: false, archived: false,
      exclude_tag_id: SPORTS_TAG_ID,
      limit: Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 50),
      order: endingSoon ? "endDate" : "volume24hr",
      ascending: endingSoon,
      end_date_min: endingSoon ? (input.now ?? new Date()).toISOString() : undefined,
      title_search: search || undefined,
      tag_slug: input.category,
      after_cursor: input.cursor
    },
    schema: keysetPage,
    maxBytes: 4_000_000,
    fetcher: options.fetcher
  });
  return {
    events: page.events.flatMap((raw) => { const event = normalizeEvent(raw); return event ? [event] : []; }),
    nextCursor: page.next_cursor || null
  };
}

/**
 * One market by Gamma id or slug, with its tags so the sports rule applies.
 * A sports market answers as not found: Aura does not offer it.
 */
export async function getMarket(ref: { id: string } | { slug: string }, options: RequestOptions = {}): Promise<PolymarketMarket> {
  let path: string;
  if ("id" in ref) {
    if (!/^\d{1,20}$/.test(ref.id)) throw new VenueError("polymarket", "invalid_request", "Unknown market.", 400);
    path = `/markets/${ref.id}`;
  } else {
    if (!/^[a-z\d-]{1,300}$/i.test(ref.slug)) throw new VenueError("polymarket", "invalid_request", "Unknown market.", 400);
    path = `/markets/slug/${ref.slug}`;
  }
  const market = await polymarketRequest({ service: "gamma", path, query: { include_tag: true }, schema: gammaMarket, maxBytes: 1_000_000, fetcher: options.fetcher });
  const event = market.events?.[0];
  const eventTags = event?.tags ?? [];
  if (isSports({ ...market, tags: [...market.tags, ...eventTags] })) throw new VenueError("polymarket", "not_found", "This market is not available.", 404);
  const normalized = normalizeMarket(market, event ? { id: event.id, title: event.title, slug: event.slug, image: event.image, tags: eventTags } : null);
  if (!normalized) throw new VenueError("polymarket", "not_found", "This market is not available.", 404);
  return normalized;
}

export type BookLevel = { price: number; size: number };
export type OrderBook = {
  tokenId: string;
  conditionId: `0x${string}`;
  /** Best first: bids high to low, asks low to high. */
  bids: BookLevel[];
  asks: BookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  tickSize: TickSize;
  minOrderSize: number;
  negRisk: boolean;
  lastTradePrice: number | null;
  observedAt: string;
};

const level = z.object({ price: numeric, size: numeric });
const bookSchema = z.object({
  market: z.string().regex(/^0x[\da-fA-F]{64}$/),
  asset_id: z.string().regex(tokenId),
  timestamp: z.string().regex(/^\d{1,16}$/).nullish(),
  bids: z.array(level).max(5_000),
  asks: z.array(level).max(5_000),
  min_order_size: numeric,
  tick_size: tickSize,
  neg_risk: z.boolean(),
  last_trade_price: numeric.nullish()
});

/** Parse a CLOB `/book` answer; the API orders levels worst first, so they are re-sorted here. */
export function parseOrderBook(raw: unknown, expectedTokenId: string, now = new Date()): OrderBook {
  const parsed = bookSchema.safeParse(raw);
  if (!parsed.success) throw new VenueError("polymarket", "invalid_response", "Polymarket sent an unexpected order book.");
  const book = parsed.data;
  if (book.asset_id !== expectedTokenId) throw new VenueError("polymarket", "invalid_response", "Polymarket sent the book for another outcome.");
  const valid = (entry: BookLevel) => entry.price > 0 && entry.price < 1 && entry.size > 0;
  const bids = book.bids.filter(valid).sort((a, b) => b.price - a.price);
  const asks = book.asks.filter(valid).sort((a, b) => a.price - b.price);
  const bestBid = bids[0]?.price ?? null, bestAsk = asks[0]?.price ?? null;
  const observedMs = book.timestamp ? Number(book.timestamp) : now.getTime();
  return {
    tokenId: book.asset_id,
    conditionId: book.market.toLowerCase() as `0x${string}`,
    bids, asks, bestBid, bestAsk,
    mid: bestBid !== null && bestAsk !== null ? Math.round(((bestBid + bestAsk) / 2) * 1e6) / 1e6 : null,
    tickSize: book.tick_size,
    minOrderSize: book.min_order_size,
    negRisk: book.neg_risk,
    lastTradePrice: book.last_trade_price ?? null,
    observedAt: new Date(observedMs).toISOString()
  };
}

/** The live order book for one outcome token. */
export async function orderBook(token: string, options: RequestOptions = {}): Promise<OrderBook> {
  if (!tokenId.test(token)) throw new VenueError("polymarket", "invalid_request", "Unknown outcome.", 400);
  const raw = await polymarketRequest({ service: "clob", path: "/book", query: { token_id: token }, schema: z.unknown(), maxBytes: 2_000_000, fetcher: options.fetcher });
  return parseOrderBook(raw, token);
}

export type OrderMarketInfo = {
  conditionId: `0x${string}`;
  tokenIds: string[];
  tickSize: TickSize;
  negRisk: boolean;
  minOrderSize: number;
  acceptingOrders: boolean;
  /** Taker fee: `shares * rate * (price * (1 - price)) ^ exponent`, in pUSD. */
  fee: { rate: number; exponent: number; takerOnly: boolean };
};

const clobMarketSchema = z.object({
  c: z.string().regex(/^0x[\da-fA-F]{64}$/).optional(),
  t: z.array(z.object({ t: z.string().regex(tokenId), o: z.string().max(300) })).min(1).max(10),
  mts: tickSize,
  nr: z.boolean().optional(),
  mos: numeric.optional(),
  ao: z.boolean().optional(),
  fd: z.object({ r: numeric.default(0), e: numeric.default(0), to: z.boolean().optional() }).nullish()
});
const byToken = z.object({ condition_id: z.string().regex(/^0x[\da-fA-F]{64}$/) });

/**
 * The CLOB's own trading parameters for the market a token belongs to. Order
 * building uses these, not Gamma's copy: the exchange enforces them.
 */
export async function orderMarketInfo(token: string, options: RequestOptions = {}): Promise<OrderMarketInfo> {
  if (!tokenId.test(token)) throw new VenueError("polymarket", "invalid_request", "Unknown outcome.", 400);
  const { condition_id: conditionId } = await polymarketRequest({ service: "clob", path: `/markets-by-token/${token}`, schema: byToken, fetcher: options.fetcher });
  const info = await polymarketRequest({ service: "clob", path: `/clob-markets/${conditionId}`, schema: clobMarketSchema, fetcher: options.fetcher });
  const tokenIds = info.t.map((entry) => entry.t);
  if (!tokenIds.includes(token)) throw new VenueError("polymarket", "invalid_response", "Polymarket sent another market for this outcome.");
  return {
    conditionId: conditionId.toLowerCase() as `0x${string}`,
    tokenIds,
    tickSize: info.mts,
    negRisk: info.nr === true,
    minOrderSize: info.mos ?? 0,
    acceptingOrders: info.ao !== false,
    fee: { rate: info.fd?.r ?? 0, exponent: info.fd?.e ?? 0, takerOnly: info.fd?.to !== false }
  };
}

const clobHistorySchema = z.object({ history: z.array(z.object({ t: z.number().int().nonnegative(), p: numeric })).max(5_000) });
const historySchema = z.object({ data: z.array(z.object({ timestamp: z.number().int().nonnegative(), price: numeric })).max(5_000) });
export type PriceInterval = "1h" | "6h" | "1d" | "1w" | "1m" | "max";
const HISTORY_BUCKET_SECONDS: Record<PriceInterval, number> = { "1h": 60, "6h": 300, "1d": 900, "1w": 3_600, "1m": 14_400, max: 86_400 };

/**
 * Price history for one outcome token, oldest first, for the odds chart.
 * Reads the CLOB's /prices-history; Polymarket's changelog names the Data
 * API's /v2/prices-history as its successor, so that is the fallback when
 * the CLOB route is down, gone, or answers in an unexpected shape.
 */
export async function priceHistory(token: string, interval: PriceInterval = "1w", options: RequestOptions = {}): Promise<Array<{ time: number; price: number }>> {
  if (!tokenId.test(token)) throw new VenueError("polymarket", "invalid_request", "Unknown outcome.", 400);
  const bucket = HISTORY_BUCKET_SECONDS[interval];
  if (bucket === undefined) throw new VenueError("polymarket", "invalid_request", "Unknown interval.", 400);
  const sorted = (points: Array<{ time: number; price: number }>) => points.sort((a, b) => a.time - b.time);
  try {
    const { history } = await polymarketRequest({ service: "clob", path: "/prices-history", query: { market: token, interval, fidelity: bucket / 60 }, schema: clobHistorySchema, maxBytes: 1_000_000, fetcher: options.fetcher });
    return sorted(history.map((point) => ({ time: point.t, price: point.p })));
  } catch (error) {
    if (!(error instanceof VenueError) || !["unavailable", "not_found", "invalid_response"].includes(error.code)) throw error;
  }
  const { data } = await polymarketRequest({ service: "data", path: "/v2/prices-history", query: { token_id: token, interval, bucket_seconds: bucket, limit: 1_000 }, schema: historySchema, maxBytes: 1_000_000, fetcher: options.fetcher });
  return sorted(data.map((point) => ({ time: point.timestamp, price: point.price })));
}

/**
 * Open short-term crypto "Up or Down" events, soonest to end first. `asset`
 * is Gamma's asset tag ("bitcoin", "ethereum", …) and `window` its window
 * tag ("5M", "15M", "1H", …). Each market's outcomes are Up (0) and Down (1).
 */
export async function listUpOrDown(input: { asset?: string; window?: string; limit?: number; cursor?: string; now?: Date } = {}, options: RequestOptions = {}): Promise<{ events: PolymarketEvent[]; nextCursor: string | null }> {
  if (input.asset !== undefined && !/^[a-z\d-]{1,40}$/i.test(input.asset)) throw new VenueError("polymarket", "invalid_request", "Unknown asset.", 400);
  if (input.window !== undefined && !/^\d{1,3}[MHDW]$/i.test(input.window)) throw new VenueError("polymarket", "invalid_request", "Unknown window.", 400);
  const page = await listEvents({ category: UP_OR_DOWN_TAG, sort: "ending_soon", limit: input.limit ?? 50, cursor: input.cursor, now: input.now }, options);
  return {
    events: page.events.filter((event) => event.upOrDown
      && (!input.asset || event.tags.some((entry) => entry.slug.toLowerCase() === input.asset?.toLowerCase()))
      && (!input.window || event.upOrDown.window === input.window.toUpperCase())),
    nextCursor: page.nextCursor
  };
}

export type ClobQuote = { tokenId: string; mid: number | null; bestBid: number | null; bestAsk: number | null };

const priceRecord = z.record(z.string(), numeric);
const sidePrices = z.record(z.string(), z.object({ BUY: numeric.optional(), SELL: numeric.optional() }));

/**
 * Live midpoint and best prices for up to 50 outcome tokens from the CLOB.
 * The CLOB's BUY price is the best bid and its SELL price the best ask.
 */
export async function clobQuotes(tokenIds: string[], options: RequestOptions = {}): Promise<ClobQuote[]> {
  if (tokenIds.length === 0 || tokenIds.length > 50 || !tokenIds.every((token) => tokenId.test(token))) throw new VenueError("polymarket", "invalid_request", "Unknown outcome.", 400);
  const [mids, prices] = await Promise.all([
    polymarketRequest({ service: "clob", method: "POST", path: "/midpoints", body: tokenIds.map((token) => ({ token_id: token })), schema: priceRecord, fetcher: options.fetcher }),
    polymarketRequest({ service: "clob", method: "POST", path: "/prices", body: tokenIds.flatMap((token) => [{ token_id: token, side: "BUY" }, { token_id: token, side: "SELL" }]), schema: sidePrices, fetcher: options.fetcher })
  ]);
  return tokenIds.map((token) => ({ tokenId: token, mid: mids[token] ?? null, bestBid: prices[token]?.BUY ?? null, bestAsk: prices[token]?.SELL ?? null }));
}

const PRICE_VARIANTS: Record<string, string> = { "5M": "fiveminute", "15M": "fifteen", "1H": "hourly", "4H": "fourhour", "1D": "daily" };
const cryptoPrice = z.object({ openPrice: numeric.nullish(), closePrice: numeric.nullish(), completed: z.boolean().nullish() });

/** The asset symbol from an Up or Down event's resolution source (a Chainlink stream or a Binance pair), or null. */
export function upOrDownSymbol(resolutionSource: string | null): string | null {
  const match = resolutionSource?.match(/data\.chain\.link\/streams\/([a-z\d]{1,12})-usd/i) ?? resolutionSource?.match(/binance\.com\/[\w/-]*?\/([A-Z\d]{1,12})_?USD/i);
  return match?.[1] ? match[1].toUpperCase() : null;
}

/**
 * The price an Up or Down market has to beat: the asset's price at the
 * window's start. Gamma carries it (`eventMetadata.priceToBeat`) only once
 * the window has resolved, so while it runs this reads polymarket.com's own
 * crypto price API, which its site uses for the same number. That API is
 * undocumented: treat it as best effort and show "unavailable" on failure.
 * Stock and metal Up or Down events (Pyth sources) return null.
 */
export async function upOrDownPriceToBeat(event: Pick<PolymarketEvent, "startTime" | "endDate" | "resolutionSource" | "upOrDown">, options: RequestOptions = {}): Promise<{ priceToBeat: number | null; closePrice: number | null; completed: boolean }> {
  if (!event.upOrDown) throw new VenueError("polymarket", "invalid_request", "Not an Up or Down event.", 400);
  if (event.upOrDown.priceToBeat !== null) return { priceToBeat: event.upOrDown.priceToBeat, closePrice: null, completed: false };
  const symbol = upOrDownSymbol(event.resolutionSource);
  const variant = event.upOrDown.window ? PRICE_VARIANTS[event.upOrDown.window] : undefined;
  if (!symbol || !variant || !event.startTime || !event.endDate) return { priceToBeat: null, closePrice: null, completed: false };
  const startTime = new Date(event.startTime), endDate = new Date(event.endDate);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endDate.getTime())) return { priceToBeat: null, closePrice: null, completed: false };
  const result = await polymarketRequest({
    service: "web", path: "/api/crypto/crypto-price",
    query: { symbol, eventStartTime: startTime.toISOString().replace(".000Z", "Z"), variant, endDate: endDate.toISOString().replace(".000Z", "Z") },
    schema: cryptoPrice, maxBytes: 10_000, fetcher: options.fetcher
  });
  return { priceToBeat: result.openPrice ?? null, closePrice: result.closePrice ?? null, completed: result.completed === true };
}
