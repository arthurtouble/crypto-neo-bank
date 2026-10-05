import { describe, expect, it } from "vitest";
import {
  addDollars, buyEstimate, chanceThen, formatAssetPrice, formatCountdown, formatWindow, mergeTicks, parseShares, predictionErrorCopy, priceStreamSubscription,
  priceToBeatFrom, sellProceeds, setupStepOf, sharesText, streamTicks, typedDecimal, upOrDownInfo, windowPhase, winningOutcome
} from "@/lib/markets/predictions-view";

describe("predictions view helpers", () => {
  it("keeps only a valid decimal of what was typed", () => {
    expect(typedDecimal("1.2.3")).toBe("1.23");
    expect(typedDecimal("12.345")).toBe("12.34");
    expect(typedDecimal("007")).toBe("7");
    expect(typedDecimal("0.5")).toBe("0.5");
    expect(typedDecimal(".")).toBe("0.");
    expect(typedDecimal("$1,250.5x")).toBe("1250.5");
    expect(typedDecimal("abc")).toBe("");
    expect(typedDecimal("1234567890123")).toBe("123456789");
    expect(typedDecimal("4.5", 0)).toBe("4");
  });

  it("reads shares up to what's held, and writes them rounded down", () => {
    expect(parseShares("12.5", 40)).toBe(12.5);
    expect(parseShares("40", 40)).toBe(40);
    expect(parseShares("40.01", 40)).toBeNull();
    expect(parseShares("0", 40)).toBeNull();
    expect(parseShares("1.234", 40)).toBeNull();
    expect(sharesText(15.678)).toBe("15.67");
    expect(sharesText(40)).toBe("40");
    expect(sharesText(0)).toBe("");
  });

  it("adds quick amounts to what's there", () => {
    expect(addDollars("", 20)).toBe("20");
    expect(addDollars("20", 1)).toBe("21");
    expect(addDollars("0.5", 100)).toBe("100.5");
  });

  it("names Up or Down windows in words", () => {
    expect(formatWindow("5M")).toBe("5 min");
    expect(formatWindow("15M")).toBe("15 min");
    expect(formatWindow("1H")).toBe("1 hour");
    expect(formatWindow("4H")).toBe("4 hours");
    expect(formatWindow("1D")).toBe("Daily");
    expect(formatWindow("1W")).toBe("Weekly");
    expect(formatWindow(null)).toBeNull();
    expect(formatWindow("soon")).toBeNull();
  });

  it("finds an Up or Down market's window and asset from its tags and Chainlink source", () => {
    const tags = (...slugs: string[]) => slugs.map((slug) => ({ slug }));
    expect(upOrDownInfo({ tags: tags("crypto", "politics"), resolutionSource: null })).toBeNull();
    expect(upOrDownInfo({ tags: tags("up-or-down", "15M", "bitcoin"), resolutionSource: "https://data.chain.link/streams/btc-usd-twap-60s-streams" }))
      .toEqual({ window: "15M", symbol: "btc", asset: "Bitcoin" });
    expect(upOrDownInfo({ tags: tags("up-or-down", "hourly", "ethereum"), resolutionSource: null })).toEqual({ window: "1H", symbol: "eth", asset: "Ethereum" });
    expect(upOrDownInfo({ tags: tags("up-or-down"), resolutionSource: "https://data.chain.link/streams/zec-usd" })).toEqual({ window: null, symbol: "zec", asset: "Zcash" });
  });

  it("counts down in minutes, hours, or days", () => {
    expect(formatCountdown(247_000)).toBe("4:07");
    expect(formatCountdown(3_900_000)).toBe("1h 05m");
    expect(formatCountdown(2 * 86_400_000 + 4 * 3_600_000)).toBe("2d 4h");
    expect(formatCountdown(-5)).toBe("0:00");
  });

  it("says where a timed market's window is", () => {
    const start = "2026-10-03T13:00:00Z", end = "2026-10-03T13:15:00Z";
    expect(windowPhase(start, end, Date.parse("2026-10-03T12:59:00Z"))).toBe("before");
    expect(windowPhase(start, end, Date.parse("2026-10-03T13:05:00Z"))).toBe("open");
    expect(windowPhase(start, end, Date.parse("2026-10-03T13:15:00Z"))).toBe("ended");
    expect(windowPhase(null, null, 0)).toBe("unknown");
  });

  it("reads the price stream's snapshot and updates for one asset only", () => {
    expect(JSON.parse(priceStreamSubscription("btc"))).toEqual({ action: "subscribe",
      subscriptions: [{ topic: "crypto_prices_chainlink", type: "*", filters: "{\"symbol\":\"btc/usd\"}" }] });
    const snapshot = JSON.stringify({ topic: "crypto_prices", type: "subscribe", payload: { symbol: "btc/usd", data: [{ timestamp: 1000, value: 84811.6 }, { timestamp: 2000, value: 84812.2 }] } });
    expect(streamTicks(snapshot, "btc")).toEqual([{ time: 1000, price: 84811.6 }, { time: 2000, price: 84812.2 }]);
    const update = JSON.stringify({ topic: "crypto_prices_chainlink", type: "update", payload: { symbol: "btc/usd", timestamp: 3000, value: 84843.1, full_accuracy_value: "1" } });
    expect(streamTicks(update, "btc")).toEqual([{ time: 3000, price: 84843.1 }]);
    expect(streamTicks(update, "eth")).toEqual([]);
    expect(streamTicks("", "btc")).toEqual([]);
    expect(streamTicks("PONG", "btc")).toEqual([]);
    expect(streamTicks("{not json", "btc")).toEqual([]);
    expect(streamTicks(JSON.stringify({ payload: { symbol: "btc/usd", timestamp: 1, value: "84000" } }), "btc")).toEqual([]);
  });

  it("merges ticks in order, one per second, and drops old ones", () => {
    const merged = mergeTicks([{ time: 1000, price: 1 }, { time: 2000, price: 2 }], [{ time: 2000, price: 2.5 }, { time: 500, price: 9 }, { time: 3000, price: 3 }], 1000);
    expect(merged).toEqual([{ time: 1000, price: 1 }, { time: 2000, price: 2.5 }, { time: 3000, price: 3 }]);
    expect(mergeTicks([], [{ time: 1, price: 1 }, { time: 2, price: 2 }, { time: 3, price: 3 }], 0, 2)).toEqual([{ time: 2, price: 2 }, { time: 3, price: 3 }]);
  });

  it("takes the price to beat from Polymarket, else the stream's tick at the start", () => {
    const start = "2026-10-03T13:15:00Z", at = Date.parse(start);
    const ticks = [{ time: at - 1000, price: 84840 }, { time: at, price: 84841.52 }, { time: at + 1000, price: 84850 }];
    expect(priceToBeatFrom(84869.81, ticks, start)).toEqual({ price: 84869.81, from: "polymarket" });
    expect(priceToBeatFrom(null, ticks, start)).toEqual({ price: 84841.52, from: "stream" });
    expect(priceToBeatFrom(null, ticks.slice(2), start)).toBeNull();
    expect(priceToBeatFrom(null, ticks, null)).toBeNull();
  });

  it("writes crypto prices with the places they need", () => {
    expect(formatAssetPrice(84912.4)).toBe("$84,912.40");
    expect(formatAssetPrice(0.182345)).toBe("$0.18235");
    expect(formatAssetPrice(null)).toBeNull();
  });

  it("says what the chance was at the start of the range", () => {
    expect(chanceThen([{ price: 0.58 }, { price: 0.63 }], "1w")).toBe("Was 58% a week ago");
    expect(chanceThen([{ price: 0.004 }, { price: 0.1 }], "1d")).toBe("Was <1% a day ago");
    expect(chanceThen([{ price: 0.5 }], "1d")).toBeNull();
  });

  it("names the winner only once a market has closed at $1", () => {
    expect(winningOutcome({ closed: true, outcomes: [{ price: 0 }, { price: 1 }] })).toBe(1);
    expect(winningOutcome({ closed: true, outcomes: [{ price: 0.5 }, { price: 0.5 }] })).toBeNull();
    expect(winningOutcome({ closed: false, outcomes: [{ price: 1 }, { price: 0 }] })).toBeNull();
  });

  it("works out what a sale brings in: about the best bid, at least 2% under it on the price steps", () => {
    const proceeds = sellProceeds(50, 0.36, 0.01);
    expect(proceeds?.about).toBeCloseTo(18);
    expect(proceeds?.atLeast).toBeCloseTo(17.5);
    expect(sellProceeds(50, null)).toBeNull();
    expect(sellProceeds(0, 0.5)).toBeNull();
  });

  it("tells the order-book sign-in from the approvals", () => {
    expect(setupStepOf({ body: { params: { typed_data: { primary_type: "ClobAuth" } } } })).toBe("connect");
    expect(setupStepOf({ body: { params: { typed_data: { primary_type: "Batch" } } } })).toBe("approve");
  });

  it("puts failures in plain words, and keeps the server's sentence otherwise", () => {
    expect(predictionErrorCopy("chain_unavailable", "Polygon could not be read.")).toBe("Your predictions account can't be reached right now. Nothing was sent. Try again in a minute.");
    expect(predictionErrorCopy("fak_not_filled", "x")).toBe("No one sold at this price in time, so nothing was bought. Try again.");
    expect(predictionErrorCopy("amount_too_small", "Add at least 2 USDC.")).toBe("Add at least 2 USDC.");
    expect(predictionErrorCopy("something_new", "Polymarket said no.")).toBe("Polymarket said no.");
    expect(predictionErrorCopy(null, "Plain words.")).toBe("Plain words.");
  });
});

describe("buyEstimate", () => {
  it("rounds shares and what they pay down to the cent, so the two always match", () => {
    expect(buyEstimate(10, 0.64)).toEqual({ shares: 15.62, toWin: 15.62 });
    expect(buyEstimate(10, 0.5)).toEqual({ shares: 20, toWin: 20 });
  });
  it("has no estimate without an amount or a usable price", () => {
    expect(buyEstimate(null, 0.5)).toBeNull();
    expect(buyEstimate(0, 0.5)).toBeNull();
    expect(buyEstimate(10, null)).toBeNull();
    expect(buyEstimate(10, 1)).toBeNull();
  });
});

describe("predictionErrorCopy wording", () => {
  it("never says \"we\" or names Polygon in a failure", () => {
    const codes = ["chain_unavailable", "unavailable", "markets_unavailable", "rate_limited", "invalid_response", "not_configured", "predictions_not_connected",
      "market_closed", "not_found", "no_buyers", "insufficient_liquidity", "fak_not_filled", "unmatched", "below_minimum", "amount_too_small", "nothing_to_redeem",
      "unsupported_asset", "insufficient_balance", "signature_expired", "signature_rejected", "feature_unavailable"];
    for (const code of codes) expect(predictionErrorCopy(code, "server words"), code).not.toMatch(/\bwe\b|\bour\b|Polygon|server words/i);
  });
});
