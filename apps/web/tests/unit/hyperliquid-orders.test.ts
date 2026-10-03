import { describe, expect, it } from "vitest";
import {
  buildCancelAction, buildCloseAction, buildOrderAction, buildPositionTpslAction, buildUpdateLeverageAction, crossLiquidationPrice,
  formatPrice, formatSize, isolatedLiquidationPrice, maintenanceMargin, meetsMinimumOrderValue, notionalToSize, orderValue,
  sizeFromMargin, slippagePrice
} from "@/lib/markets/hyperliquid/orders";
import { VenueError } from "@/lib/markets/types";

const btc = { coin: "BTC", assetIndex: 0, szDecimals: 5, maxLeverage: 40, midPx: "84596.5" };
const eth = { coin: "ETH", assetIndex: 1, szDecimals: 4, maxLeverage: 25, midPx: "2684.55" };

describe("Hyperliquid price and size rules", () => {
  it.each([
    ["1234567", 0, "1234567"], // whole numbers are always valid
    ["123456.7", 0, "123456"],
    ["12345.6", 0, "12345"],
    ["0.00123456", 0, "0.001234"],
    ["0.1234567", 0, "0.12345"], // 6 - 0 decimals, then 5 significant figures
    ["123.456", 5, "123.4"], // 6 - 5 = 1 decimal
    ["84596.5", 5, "84596"],
    ["2684.556", 4, "2684.5"],
    ["1.1000", 0, "1.1"],
    ["00.123", 0, "0.123"],
    ["0.0001", 0, "0.0001"], // PURR minimum tick
    ["0.00001", 1, "0.00001"],
    ["0.01", 2, "0.01"],
    ["1", 5, "1"]
  ])("formatPrice(%s, %i) = %s", (price, szDecimals, expected) => {
    expect(formatPrice(price, szDecimals)).toBe(expected);
  });

  it.each([["0.0000001", 0], ["abc", 0], ["", 0], [".", 0], ["-1", 0], ["1e5", 0], ["0.1", 6]])(
    "formatPrice refuses %s at szDecimals %i", (price, szDecimals) => {
      expect(() => formatPrice(price, szDecimals)).toThrow(VenueError);
    });

  it.each([
    ["123.456789", 2, "123.45"],
    ["1.0000", 4, "1"],
    ["00.123", 3, "0.123"],
    ["0.00001", 5, "0.00001"],
    ["16.112019", 5, "16.11201"],
    ["100", 0, "100"]
  ])("formatSize(%s, %i) = %s", (size, szDecimals, expected) => {
    expect(formatSize(size, szDecimals)).toBe(expected);
  });

  it("refuses sizes that round to zero or are not numbers", () => {
    expect(() => formatSize("0.0000001", 0)).toThrow(VenueError);
    expect(() => formatSize("1.5", 7)).toThrow(VenueError);
    expect(() => formatSize("-10.5", 1)).toThrow(VenueError);
  });

  it("converts dollars to size, rounding down to the lot", () => {
    expect(notionalToSize("100", "84596.5", 5)).toBe("0.00118");
    expect(notionalToSize("25.5", "2684.55", 4)).toBe("0.0094");
    expect(notionalToSize("10", "0.37621", 0)).toBe("26");
    expect(() => notionalToSize("0.5", "84596.5", 5)).toThrow(VenueError);
  });

  it("checks Hyperliquid's $10 minimum exactly, without floats", () => {
    expect(orderValue("0.00118", "84596")).toBe("99.82328");
    expect(meetsMinimumOrderValue("0.0001", "100000")).toBe(true);
    expect(meetsMinimumOrderValue("0.00011", "90909")).toBe(false); // 9.99999
    expect(meetsMinimumOrderValue("0.1", "100")).toBe(true);
  });

  it("moves the reference price against the trader", () => {
    expect(slippagePrice("84596.5", "buy", 100, 5)).toBe("85442");
    expect(slippagePrice("84596.5", "sell", 100, 5)).toBe("83750");
    expect(slippagePrice("2684.55", "buy", 50, 4)).toBe("2697.9");
    expect(() => slippagePrice("100", "buy", 0, 0)).toThrow(VenueError);
    expect(() => slippagePrice("100", "buy", 1_001, 0)).toThrow(VenueError);
  });
});

describe("Hyperliquid order actions", () => {
  it("builds a market buy as IOC at mid plus slippage with wire key order", () => {
    const action = buildOrderAction({ market: btc, side: "buy", size: "0.001234567", type: "market" });
    expect(action).toEqual({ type: "order", grouping: "na",
      orders: [{ a: 0, b: true, p: "85442", s: "0.00123", r: false, t: { limit: { tif: "Ioc" } } }] });
    expect(Object.keys(action)).toEqual(["type", "orders", "grouping"]);
    expect(Object.keys(action.orders[0])).toEqual(["a", "b", "p", "s", "r", "t"]);
  });

  it("builds a resting limit sell", () => {
    const action = buildOrderAction({ market: eth, side: "sell", size: "0.5", type: "limit", limitPrice: "3000.123" });
    expect(action.orders[0]).toEqual({ a: 1, b: false, p: "3000.1", s: "0.5", r: false, t: { limit: { tif: "Gtc" } } });
  });

  it("refuses orders under $10, limit orders without a price, and markets without a mid", () => {
    expect(() => buildOrderAction({ market: btc, side: "buy", size: "0.0001", type: "market" })).toThrow(/at least \$10/);
    expect(() => buildOrderAction({ market: btc, side: "buy", size: "0.01", type: "limit" })).toThrow(VenueError);
    expect(() => buildOrderAction({ market: { ...btc, midPx: null }, side: "buy", size: "0.01", type: "market" }))
      .toThrow(expect.objectContaining({ code: "no_liquidity" }));
  });

  it("closes a short with a reduce-only IOC buy for the full size, even under $10", () => {
    const action = buildCloseAction({ coin: "BTC", size: "-0.00005" }, btc);
    expect(action.orders[0]).toEqual({ a: 0, b: true, p: "85442", s: "0.00005", r: true, t: { limit: { tif: "Ioc" } } });
    expect(buildCloseAction({ coin: "ETH", size: "20.8257" }, eth, 200).orders[0]).toMatchObject({ b: false, p: "2630.8", s: "20.8257" });
    expect(() => buildCloseAction({ coin: "ETH", size: "1" }, btc)).toThrow(VenueError);
  });

  it("builds cancel and leverage actions within the market's limits", () => {
    expect(buildCancelAction(1, 564243798110)).toEqual({ type: "cancel", cancels: [{ a: 1, o: 564243798110 }] });
    expect(buildUpdateLeverageAction(eth, true, 25)).toEqual({ type: "updateLeverage", asset: 1, isCross: true, leverage: 25 });
    expect(() => buildUpdateLeverageAction(eth, true, 26)).toThrow(VenueError);
    expect(() => buildUpdateLeverageAction(eth, false, 0)).toThrow(VenueError);
    expect(() => buildUpdateLeverageAction(eth, false, 2.5)).toThrow(VenueError);
    expect(() => buildUpdateLeverageAction({ ...eth, onlyIsolated: true }, true, 3)).toThrow(/isolated/);
  });
});

describe("Hyperliquid take profit and stop loss", () => {
  const spcx = { coin: "xyz:SPCX", assetIndex: 110_076, szDecimals: 2, maxLeverage: 20, midPx: "159.03", markPx: "159.02" };

  it("attaches TP/SL to a new order as normalTpsl: entry, then reduce-only triggers on the other side", () => {
    const action = buildOrderAction({ market: btc, side: "buy", size: "0.001", type: "market",
      takeProfit: { triggerPrice: "95000" }, stopLoss: { triggerPrice: "80000.5", limitPrice: "79000" } });
    expect(action.grouping).toBe("normalTpsl");
    expect(action.orders).toEqual([
      { a: 0, b: true, p: "85442", s: "0.001", r: false, t: { limit: { tif: "Ioc" } } },
      { a: 0, b: false, p: "85500", s: "0.001", r: true, t: { trigger: { isMarket: true, triggerPx: "95000", tpsl: "tp" } } },
      { a: 0, b: false, p: "79000", s: "0.001", r: true, t: { trigger: { isMarket: false, triggerPx: "80000", tpsl: "sl" } } }
    ]);
    expect(Object.keys((action.orders[1].t as { trigger: object }).trigger)).toEqual(["isMarket", "triggerPx", "tpsl"]);
  });

  it("puts a short's take profit below and stop loss above, and refuses the wrong side", () => {
    const action = buildOrderAction({ market: spcx, side: "sell", size: "1", type: "limit", limitPrice: "160",
      takeProfit: { triggerPrice: "140" }, stopLoss: { triggerPrice: "170" } });
    expect(action.orders.slice(1).map((order) => [order.b, order.p, order.r])).toEqual([[true, "154", true], [true, "187", true]]);
    expect(() => buildOrderAction({ market: spcx, side: "sell", size: "1", type: "limit", limitPrice: "160",
      takeProfit: { triggerPrice: "170" } })).toThrow(/below/);
    expect(() => buildOrderAction({ market: btc, side: "buy", size: "0.001", type: "market", stopLoss: { triggerPrice: "90000" } }))
      .toThrow(/below/);
    expect(() => buildOrderAction({ market: btc, side: "sell", size: "0.001", type: "market", reduceOnly: true,
      stopLoss: { triggerPrice: "90000" } })).toThrow(VenueError);
  });

  it("sets TP/SL on a whole position as positionTpsl, checked against the mark", () => {
    const action = buildPositionTpslAction({ position: { coin: "xyz:SPCX", size: "-3.14" }, market: spcx,
      takeProfit: { triggerPrice: "120" }, stopLoss: { triggerPrice: "175.555" } });
    expect(action).toEqual({ type: "order", grouping: "positionTpsl", orders: [
      { a: 110_076, b: true, p: "132", s: "3.14", r: true, t: { trigger: { isMarket: true, triggerPx: "120", tpsl: "tp" } } },
      { a: 110_076, b: true, p: "193.1", s: "3.14", r: true, t: { trigger: { isMarket: true, triggerPx: "175.55", tpsl: "sl" } } }
    ] });
    expect(() => buildPositionTpslAction({ position: { coin: "xyz:SPCX", size: "2" }, market: spcx, stopLoss: { triggerPrice: "160" } }))
      .toThrow(/below/);
    expect(() => buildPositionTpslAction({ position: { coin: "xyz:SPCX", size: "2" }, market: spcx })).toThrow(VenueError);
    expect(() => buildPositionTpslAction({ position: { coin: "BTC", size: "2" }, market: spcx, stopLoss: { triggerPrice: "1" } }))
      .toThrow(VenueError);
  });
});

describe("Hyperliquid sizing from dollars and liquidation estimates", () => {
  it("turns margin and leverage into a lot-rounded size, with the margin really used", () => {
    expect(sizeFromMargin({ marginUsd: "50", leverage: 10, price: "84596.5", market: btc }))
      .toEqual({ size: "0.00591", notional: "499.965315", margin: "50" });
    expect(sizeFromMargin({ marginUsd: "5", leverage: 3, price: "159.03", market: { szDecimals: 2, maxLeverage: 20 } }))
      .toEqual({ size: "0.09", notional: "14.3127", margin: "4.78" });
    expect(() => sizeFromMargin({ marginUsd: "5", leverage: 1, price: "159.03", market: { szDecimals: 2, maxLeverage: 20 } }))
      .toThrow(/at least \$10/);
    expect(() => sizeFromMargin({ marginUsd: "50", leverage: 41, price: "84596.5", market: btc })).toThrow(/between 1 and 40/);
  });

  it("reproduces Hyperliquid's cross liquidation prices for live positions", () => {
    // A real account's BTC and ETH shorts: cross account value 1595783.804191, cross maintenance margin 27179.496038.
    const account = { accountValue: "1595783.804191", maintenanceMarginUsed: "27179.496038" };
    expect(crossLiquidationPrice({ side: "short", size: "-16.42963", price: "84547", maxLeverage: 40, ...account })).toBe("178842");
    expect(crossLiquidationPrice({ side: "short", size: "32.5438", price: "2682.7", maxLeverage: 25, ...account })).toBe("49937.4");
    expect(crossLiquidationPrice({ side: "long", size: "1", price: "100", maxLeverage: 10, accountValue: "1000",
      maintenanceMarginUsed: "5" })).toBeNull();
  });

  it("estimates an isolated liquidation price from leverage alone", () => {
    // 10x long, max 20x: l = 2.5%, liq = 100 − 100 × (10% − 2.5%) ÷ (1 − 2.5%) ≈ 92.3077.
    expect(isolatedLiquidationPrice({ side: "long", entryPx: "100", leverage: 10, maxLeverage: 20 })).toBe("92.3077");
    expect(isolatedLiquidationPrice({ side: "short", entryPx: "100", leverage: 10, maxLeverage: 20 })).toBe("107.317");
    expect(isolatedLiquidationPrice({ side: "long", entryPx: "100", leverage: 2, maxLeverage: 3 })).toBe("60");
    expect(isolatedLiquidationPrice({ side: "long", entryPx: "100", leverage: 1, maxLeverage: 3 })).toBeNull(); // a 1x long can't be liquidated
    expect(() => isolatedLiquidationPrice({ side: "long", entryPx: "100", leverage: 21, maxLeverage: 20 })).toThrow(VenueError);
  });

  it("adds a new position's maintenance margin for a pre-trade cross estimate", () => {
    const extra = maintenanceMargin("0.1", "84000", 40);
    expect(extra).toBeCloseTo(105, 6);
    expect(crossLiquidationPrice({ side: "long", size: "0.1", price: "84000", maxLeverage: 40, accountValue: "1000",
      maintenanceMarginUsed: extra })).toBe("74936.7"); // 84000 − (1000 − 105) ÷ 0.1 ÷ (1 − 1.25%)
  });
});
