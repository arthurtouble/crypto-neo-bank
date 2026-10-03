import { describe, expect, it, vi } from "vitest";
import { VenueError } from "@/lib/markets/types";
import {
  clobQuotes, getMarket, isSports, listEvents, listUpOrDown, normalizeEvent, orderBook, orderMarketInfo, parseOrderBook, priceHistory, upOrDownPriceToBeat, upOrDownSymbol
} from "@/lib/markets/polymarket/markets";

const YES = "17010377994663817312158123655937348199252960045746746128731746451645055725586";
const NO = "61725366781282351729996972759460154434089275036953062948669003249092837754960";
const CONDITION = "0xa69ef420d8b4075ad8ba8611d02c63cb2ece46f5c8c643af223c272689b0c96f";

/** A Gamma market as /events/keyset nests it (fields trimmed to what Aura reads). */
function market(overrides: Record<string, unknown> = {}) {
  return {
    id: "2589810", question: "Will the Fed decrease interest rates by 50+ bps after the October 2026 meeting?", conditionId: CONDITION,
    slug: "fed-50-bps-october", endDate: "2026-10-29T03:59:00Z", image: null, outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"0.0025\", \"0.9975\"]",
    clobTokenIds: JSON.stringify([YES, NO]), volumeNum: 3709746.05, volume24hr: 165616.99, liquidityNum: 904850.95, negRisk: true,
    orderPriceMinTickSize: 0.001, orderMinSize: 5, active: true, closed: false, archived: false, acceptingOrders: true, enableOrderBook: true,
    bestBid: 0.002, bestAsk: 0.003, ...overrides
  };
}

function event(overrides: Record<string, unknown> = {}, markets: unknown[] = [market()]) {
  return {
    id: "606422", title: "Fed Decision in October?", slug: "fed-decision-in-october", image: "https://example.test/fed.png", endDate: "2026-10-29T00:00:00Z",
    volume: 1e7, volume24hr: 5e5, liquidity: 2e6, negRisk: true, closed: false, archived: false,
    tags: [{ id: "100196", slug: "fed", label: "Fed" }, { id: "2", slug: "politics", label: "Politics" }], markets, ...overrides
  };
}

describe("Sports exclusion", () => {
  it.each([
    ["the Sports tag by id", { tags: [{ id: "1", slug: "anything" }] }],
    ["the sports slug", { tags: [{ id: "9", slug: "Sports" }] }],
    ["the esports slug", { tags: [{ id: "64", slug: "esports" }] }],
    ["a game id", { gameId: 1711371 }],
    ["a sports market type", { sportsMarketType: "child_moneyline" }],
    ["teams", { teamAID: "123" }]
  ])("treats %s as sports", (_name, signals) => {
    expect(isSports(signals)).toBe(true);
  });

  it("keeps ordinary markets, including video-game culture markets", () => {
    expect(isSports({ tags: [{ id: "100639", slug: "games" }, { id: "2", slug: "politics" }], gameId: null, sportsMarketType: "" })).toBe(false);
  });

  it("drops sports events and sports markets inside other events", () => {
    expect(normalizeEvent(event({ tags: [{ id: "1", slug: "sports", label: "Sports" }] }))).toBeNull();
    expect(normalizeEvent(event({ gameId: 1711371 }))).toBeNull();
    const mixed = normalizeEvent(event({}, [market(), market({ id: "2", sportsMarketType: "moneyline" })]));
    expect(mixed?.markets.map((item) => item.id)).toEqual(["2589810"]);
  });
});

describe("Event listing", () => {
  it("normalizes a Gamma event into tradeable binary markets", () => {
    const normalized = normalizeEvent(event());
    expect(normalized).toMatchObject({ id: "606422", title: "Fed Decision in October?", negRisk: true, tags: [{ slug: "fed", label: "Fed" }, { slug: "politics", label: "Politics" }] });
    expect(normalized?.markets[0]).toEqual(expect.objectContaining({
      id: "2589810", conditionId: CONDITION, eventTitle: "Fed Decision in October?", image: "https://example.test/fed.png",
      yesTokenId: YES, noTokenId: NO, tickSize: 0.001, minOrderSize: 5, negRisk: true, acceptingOrders: true, closed: false,
      outcomes: [{ name: "Yes", tokenId: YES, price: 0.0025 }, { name: "No", tokenId: NO, price: 0.9975 }], volume: 3709746.05, liquidity: 904850.95
    }));
  });

  it("skips closed, paused, malformed, and non-binary markets without failing the event", () => {
    const normalized = normalizeEvent(event({}, [
      market({ id: "1", closed: true }), market({ id: "2", acceptingOrders: false }), market({ id: "3", clobTokenIds: "not json" }),
      market({ id: "4", outcomes: "[\"A\",\"B\",\"C\"]", clobTokenIds: JSON.stringify([YES, NO, "5"]) }), market({ id: "5", orderPriceMinTickSize: 0.02 }), market({ id: "6" })
    ]));
    expect(normalized?.markets.map((item) => item.id)).toEqual(["6"]);
    expect(normalizeEvent(event({}, [market({ closed: true })]))).toBeNull();
  });

  it("asks Gamma for open non-sports events, sorted and filtered, and pages by cursor", async () => {
    const fetcher = vi.fn(async () => Response.json({ events: [event(), event({ id: "7", tags: [{ id: "1", slug: "sports" }] })], next_cursor: "abc_123" })) as unknown as typeof fetch;
    const result = await listEvents({ search: " fed ", category: "economy", sort: "ending_soon", limit: 10, now: new Date("2026-10-03T00:00:00Z") }, { fetcher });
    expect(result.events.map((item) => item.id)).toEqual(["606422"]);
    expect(result.nextCursor).toBe("abc_123");
    const url = new URL(vi.mocked(fetcher).mock.calls[0]?.[0] as string);
    expect(url.origin + url.pathname).toBe("https://gamma-api.polymarket.com/events/keyset");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      active: "true", closed: "false", archived: "false", exclude_tag_id: "1", limit: "10", order: "endDate", ascending: "true",
      end_date_min: "2026-10-03T00:00:00.000Z", title_search: "fed", tag_slug: "economy"
    });
  });

  it("sorts by 24 hour volume by default and refuses sports as a category", async () => {
    const fetcher = vi.fn(async () => Response.json({ events: [], next_cursor: null })) as unknown as typeof fetch;
    await listEvents({}, { fetcher });
    const url = new URL(vi.mocked(fetcher).mock.calls[0]?.[0] as string);
    expect(url.searchParams.get("order")).toBe("volume24hr");
    expect(url.searchParams.get("ascending")).toBe("false");
    await expect(listEvents({ category: "sports" }, { fetcher })).resolves.toEqual({ events: [], nextCursor: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(listEvents({ category: "a b" }, { fetcher })).rejects.toBeInstanceOf(VenueError);
  });
});

describe("Market detail", () => {
  it("reads a market with its tags and parent event", async () => {
    const fetcher = vi.fn(async () => Response.json(market({ tags: [{ id: "100196", slug: "fed", label: "Fed" }], events: [{ id: "606422", title: "Fed Decision in October?", slug: "fed-decision-in-october", image: null }] }))) as unknown as typeof fetch;
    const result = await getMarket({ slug: "fed-50-bps-october" }, { fetcher });
    expect(result).toMatchObject({ id: "2589810", eventId: "606422", eventTitle: "Fed Decision in October?", tags: [{ slug: "fed", label: "Fed" }] });
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe("https://gamma-api.polymarket.com/markets/slug/fed-50-bps-october?include_tag=true");
  });

  it("answers a sports market as not found", async () => {
    const fetcher = vi.fn(async () => Response.json(market({ sportsMarketType: "child_moneyline", gameId: "233098", tags: [{ id: "1", slug: "sports", label: "Sports" }] }))) as unknown as typeof fetch;
    await expect(getMarket({ id: "5011083" }, { fetcher })).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(getMarket({ id: "../x" }, { fetcher })).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("Order books and trading parameters", () => {
  const raw = {
    market: CONDITION, asset_id: YES, timestamp: "1791019095549", hash: "126bd593be701dbcb24c86fadb0cbf267d6821be",
    bids: [{ price: "0.001", size: "3149139.52" }, { price: "0.002", size: "171521.33" }],
    asks: [{ price: "0.999", size: "31015550.64" }, { price: "0.004", size: "12494.35" }, { price: "0.003", size: "732506.89" }],
    min_order_size: "5", tick_size: "0.001", neg_risk: true, last_trade_price: "0.002"
  };

  it("sorts levels best first and derives best prices and the midpoint", () => {
    const parsed = parseOrderBook(raw, YES);
    expect(parsed.bids.map((entry) => entry.price)).toEqual([0.002, 0.001]);
    expect(parsed.asks.map((entry) => entry.price)).toEqual([0.003, 0.004, 0.999]);
    expect(parsed).toMatchObject({ bestBid: 0.002, bestAsk: 0.003, mid: 0.0025, tickSize: 0.001, minOrderSize: 5, negRisk: true, lastTradePrice: 0.002, observedAt: new Date(1791019095549).toISOString() });
    expect(() => parseOrderBook(raw, NO)).toThrow(VenueError);
  });

  it("fetches a book by token id", async () => {
    const fetcher = vi.fn(async () => Response.json(raw)) as unknown as typeof fetch;
    await expect(orderBook(YES, { fetcher })).resolves.toMatchObject({ tokenId: YES, bestAsk: 0.003 });
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe(`https://clob.polymarket.com/book?token_id=${YES}`);
    await expect(orderBook("0xabc", { fetcher })).rejects.toBeInstanceOf(VenueError);
  });

  it("reads the CLOB's own tick size, neg risk flag, minimum, and fee terms", async () => {
    const answers = [
      { condition_id: CONDITION, primary_token_id: YES, secondary_token_id: NO },
      { r: { mi: 50 }, t: [{ t: YES, o: "Yes" }, { t: NO, o: "No" }], c: CONDITION, mos: 5, mts: 0.001, ao: true, nr: true, fd: { r: 0.05, e: 1, to: true }, v: "v1" }
    ];
    const fetcher = vi.fn(async () => Response.json(answers.shift())) as unknown as typeof fetch;
    await expect(orderMarketInfo(YES, { fetcher })).resolves.toEqual({
      conditionId: CONDITION, tokenIds: [YES, NO], tickSize: 0.001, negRisk: true, minOrderSize: 5, acceptingOrders: true, fee: { rate: 0.05, exponent: 1, takerOnly: true }
    });
    expect(vi.mocked(fetcher).mock.calls.map((call) => call[0])).toEqual([`https://clob.polymarket.com/markets-by-token/${YES}`, `https://clob.polymarket.com/clob-markets/${CONDITION}`]);
  });

  it("reads price history from the CLOB, oldest first", async () => {
    const fetcher = vi.fn(async () => Response.json({ history: [{ t: 20, p: 0.5 }, { t: 10, p: 0.4 }] })) as unknown as typeof fetch;
    await expect(priceHistory(YES, "1w", { fetcher })).resolves.toEqual([{ time: 10, price: 0.4 }, { time: 20, price: 0.5 }]);
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe(`https://clob.polymarket.com/prices-history?market=${YES}&interval=1w&fidelity=60`);
    await expect(priceHistory("abc", "1w", { fetcher })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("falls back to the Data API when the CLOB route is gone, but not when it refuses", async () => {
    const answers = [Response.json({ error: "gone" }, { status: 404 }), Response.json({ data: [{ timestamp: 10, price: 0.4, resolution_seconds: 60 }] })];
    const fetcher = vi.fn(async () => answers.shift()) as unknown as typeof fetch;
    await expect(priceHistory(YES, "1h", { fetcher })).resolves.toEqual([{ time: 10, price: 0.4 }]);
    expect(vi.mocked(fetcher).mock.calls[1]?.[0]).toBe(`https://data-api.polymarket.com/v2/prices-history?token_id=${YES}&interval=1h&bucket_seconds=60&limit=1000`);
    const refused = vi.fn(async () => Response.json({ error: "bad interval" }, { status: 400 })) as unknown as typeof fetch;
    await expect(priceHistory(YES, "1h", { fetcher: refused })).rejects.toMatchObject({ code: "rejected" });
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("reads live midpoints and best prices for many outcomes at once", async () => {
    const fetcher = vi.fn(async (url: string) => Response.json(url.endsWith("/midpoints")
      ? { [YES]: "0.0025", [NO]: "0.9975" }
      : { [YES]: { BUY: "0.002", SELL: "0.003" }, [NO]: { BUY: "0.997" } })) as unknown as typeof fetch;
    await expect(clobQuotes([YES, NO], { fetcher })).resolves.toEqual([
      { tokenId: YES, mid: 0.0025, bestBid: 0.002, bestAsk: 0.003 },
      { tokenId: NO, mid: 0.9975, bestBid: 0.997, bestAsk: null }
    ]);
    const prices = vi.mocked(fetcher).mock.calls.find((call) => String(call[0]).endsWith("/prices")) as unknown as [string, RequestInit];
    expect(JSON.parse(prices[1].body as string)).toEqual([{ token_id: YES, side: "BUY" }, { token_id: YES, side: "SELL" }, { token_id: NO, side: "BUY" }, { token_id: NO, side: "SELL" }]);
    await expect(clobQuotes([], { fetcher })).rejects.toBeInstanceOf(VenueError);
    await expect(clobQuotes(Array.from({ length: 51 }, () => YES), { fetcher })).rejects.toBeInstanceOf(VenueError);
  });
});

describe("Crypto Up or Down", () => {
  const UP = "1001", DOWN = "1002";
  // Trimmed from a live Gamma event (October 2026).
  const upOrDown = (overrides: Record<string, unknown> = {}, window = "15M") => event({
    id: "900", title: "Bitcoin Up or Down - October 3, 5:30AM-5:45AM ET", slug: "btc-updown-15m-1791019800", negRisk: false,
    startTime: "2026-10-03T09:30:00Z", endDate: "2026-10-03T09:45:00Z", resolutionSource: "",
    tags: ["up-or-down", "crypto-prices", "recurring", "crypto", "bitcoin", window].map((slug, index) => ({ id: String(500 + index), slug, label: slug })),
    ...overrides
  }, [market({
    id: "901", question: "Bitcoin Up or Down - October 3, 5:30AM-5:45AM ET", outcomes: "[\"Up\", \"Down\"]", outcomePrices: "[\"0.55\", \"0.45\"]",
    clobTokenIds: JSON.stringify([UP, DOWN]), negRisk: false, orderPriceMinTickSize: 0.01, eventStartTime: "2026-10-03T09:30:00Z", endDate: "2026-10-03T09:45:00Z",
    resolutionSource: "https://data.chain.link/streams/btc-usd-twap-60s-streams"
  })]);

  it("reads the window, start, end, resolution source, and Up and Down token ids", () => {
    const normalized = normalizeEvent(upOrDown());
    expect(normalized).toMatchObject({
      startTime: "2026-10-03T09:30:00Z", endDate: "2026-10-03T09:45:00Z", upOrDown: { window: "15M", priceToBeat: null },
      resolutionSource: "https://data.chain.link/streams/btc-usd-twap-60s-streams"
    });
    expect(normalized?.markets[0]).toMatchObject({
      startTime: "2026-10-03T09:30:00Z", endDate: "2026-10-03T09:45:00Z", tickSize: 0.01, minOrderSize: 5,
      outcomes: [{ name: "Up", tokenId: UP, price: 0.55 }, { name: "Down", tokenId: DOWN, price: 0.45 }]
    });
    expect(normalizeEvent(upOrDown({ eventMetadata: { priceToBeat: 84577.05, finalPrice: 84571.6 } }))?.upOrDown).toEqual({ window: "15M", priceToBeat: 84577.05 });
    expect(normalizeEvent(upOrDown({}, "4h"))?.upOrDown?.window).toBe("4H");
    expect(normalizeEvent(upOrDown({}, "daily"))?.upOrDown?.window).toBe("1D");
    expect(normalizeEvent(event())?.upOrDown).toBeNull();
  });

  it("lists the soonest-ending windows, filtered by asset and window", async () => {
    const eth = upOrDown({ id: "910", tags: [{ id: "1", slug: "up-or-down" }, { id: "2", slug: "ethereum" }, { id: "3", slug: "15M" }].map((tag) => ({ ...tag, id: `7${tag.id}`, label: tag.slug })) });
    const fetcher = vi.fn(async () => Response.json({ events: [upOrDown(), upOrDown({ id: "902" }, "5M"), eth], next_cursor: null })) as unknown as typeof fetch;
    const result = await listUpOrDown({ asset: "bitcoin", window: "15m", now: new Date("2026-10-03T09:31:00Z") }, { fetcher });
    expect(result.events.map((item) => item.id)).toEqual(["900"]);
    const url = new URL(vi.mocked(fetcher).mock.calls[0]?.[0] as string);
    expect(url.searchParams.get("tag_slug")).toBe("up-or-down");
    expect(url.searchParams.get("order")).toBe("endDate");
    expect(url.searchParams.get("exclude_tag_id")).toBe("1");
    await expect(listUpOrDown({ window: "soon" }, { fetcher })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("reads the price to beat from Gamma once set, and from polymarket.com while the window runs", async () => {
    const normalized = normalizeEvent(upOrDown())!;
    const fetcher = vi.fn(async () => Response.json({ openPrice: 84577.05840009113, closePrice: null, completed: false, incomplete: true })) as unknown as typeof fetch;
    await expect(upOrDownPriceToBeat(normalized, { fetcher })).resolves.toEqual({ priceToBeat: 84577.05840009113, closePrice: null, completed: false });
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe("https://polymarket.com/api/crypto/crypto-price?symbol=BTC&eventStartTime=2026-10-03T09%3A30%3A00Z&variant=fifteen&endDate=2026-10-03T09%3A45%3A00Z");
    const settled = normalizeEvent(upOrDown({ eventMetadata: { priceToBeat: 1 } }))!;
    await expect(upOrDownPriceToBeat(settled, { fetcher })).resolves.toMatchObject({ priceToBeat: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(upOrDownPriceToBeat(normalizeEvent(event())!, { fetcher })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("finds the asset symbol in Chainlink and Binance sources only", () => {
    expect(upOrDownSymbol("https://data.chain.link/streams/eth-usd-twap-60s-streams")).toBe("ETH");
    expect(upOrDownSymbol("https://www.binance.com/en/trade/SOL_USDT")).toBe("SOL");
    expect(upOrDownSymbol("https://pythdata.app/explore/Equity.US.SPY")).toBeNull();
    expect(upOrDownSymbol(null)).toBeNull();
  });
});
