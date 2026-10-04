import { describe, expect, it } from "vitest";
import {
  addableFromBase, availableToTrade, bookGroupingQuery, bookGroupings, cleanDecimal, cleanWhole, closeSize, fillDirection, formatStep, maxOrderMargin,
  orderKind, orderRefusal, pnlAt, triggerProblem
} from "@/lib/markets/view";

describe("Perps view helpers", () => {
  it("keeps only a valid decimal in number fields", () => {
    expect(cleanDecimal("1a2.3.4")).toBe("12.34");
    expect(cleanDecimal("abc")).toBe("");
    expect(cleanDecimal("-5")).toBe("5");
    expect(cleanDecimal("1e5")).toBe("15");
    expect(cleanDecimal("84,553.5")).toBe("84553.5");
    expect(cleanDecimal(".5")).toBe("0.5");
    expect(cleanDecimal("007")).toBe("7");
    expect(cleanDecimal("12.3456", 2)).toBe("12.34");
    expect(cleanDecimal("12.", 2)).toBe("12.");
    expect(cleanDecimal("12.9", 0)).toBe("12");
    expect(cleanWhole("4x0", 40)).toBe("40");
    expect(cleanWhole("99", 40)).toBe("40");
    expect(cleanWhole("", 40)).toBe("");
    expect(cleanWhole("05", 40)).toBe("5");
  });

  it("offers the order book's groupings as dollar steps that suit the price", () => {
    const btc = bookGroupings("84553", 5);
    expect(btc.map((option) => option.label)).toEqual(["1", "2", "5", "10", "100", "1,000"]);
    expect(btc.map((option) => bookGroupingQuery(option))).toEqual(["", "&sig=5&mantissa=2", "&sig=5&mantissa=5", "&sig=4", "&sig=3", "&sig=2"]);
    expect(bookGroupings("3120.4", 4).map((option) => option.label)).toEqual(["0.1", "0.2", "0.5", "1", "10", "100"]);
    expect(bookGroupings("148.62", 2).map((option) => option.label)).toEqual(["0.01", "0.02", "0.05", "0.1", "1", "10"]);
    // A price capped by its decimals rather than its significant figures starts coarser, and nothing finer is offered.
    expect(bookGroupings("0.05123", 2).map((option) => option.label)).toEqual(["0.0001", "0.001"]);
    expect(bookGroupings(null, 2)).toEqual([]);
    expect(formatStep(1000)).toBe("1,000");
    expect(formatStep(0.05)).toBe("0.05");
  });

  it("says what's available to trade, and what one tap can add from Base", () => {
    // Al's account: worth 7.55 with 5.98 in margin; nothing withdrawable, but 1.57 to trade.
    expect(availableToTrade({ accountValue: "7.55", totalMarginUsed: "5.98" })).toBe(1.57);
    expect(availableToTrade({ accountValue: "5", totalMarginUsed: "6" })).toBe(0);
    expect(addableFromBase(10.56)).toBe(9.56);
    expect(addableFromBase(5.5)).toBe(0);
    expect(addableFromBase(null)).toBe(0);
    expect(maxOrderMargin(1.57, 10.56)).toBe(11.13);
    expect(maxOrderMargin(1.57, 3)).toBe(1.57);
    expect(maxOrderMargin(null, 100)).toBeNull();
  });

  it("estimates profit at a price, and checks take profit and stop loss sides", () => {
    expect(pnlAt("long", 0.01, 64_000, 66_000)).toBeCloseTo(20);
    expect(pnlAt("short", 0.01, 64_000, 66_000)).toBeCloseTo(-20);
    expect(pnlAt("long", 0, 64_000, 66_000)).toBeNull();
    expect(triggerProblem("tp", "long", 70_000, 64_000)).toBeNull();
    expect(triggerProblem("tp", "long", 60_000, 64_000)).toBe("Take profit must be above the price.");
    expect(triggerProblem("sl", "long", 66_000, 64_000)).toBe("Stop loss must be below the price.");
    expect(triggerProblem("tp", "short", 66_000, 64_000)).toBe("Take profit must be below the price.");
    expect(triggerProblem("sl", "short", 60_000, 64_000)).toBe("Stop loss must be above the price.");
    expect(triggerProblem("sl", "short", null, 64_000)).toBeNull();
  });

  it("sizes a partial close down to the market's lot", () => {
    expect(closeSize("-0.05", 1, 5)).toBe("0.05");
    expect(closeSize("0.05", 0.25, 5)).toBe("0.0125");
    expect(closeSize("0.00003", 0.25, 5)).toBeNull();
    expect(closeSize("3", 0.5, 0)).toBe("1");
    expect(closeSize("12.5", 0.75, 2)).toBe("9.37");
  });

  it("names fills and orders in plain words", () => {
    expect(fillDirection("Open Long")).toBe("Opened long");
    expect(fillDirection("Close Short")).toBe("Closed short");
    expect(fillDirection("Long > Short")).toBe("Switched to short");
    expect(fillDirection("Liquidated Cross Long")).toBe("Liquidated");
    expect(orderKind("Take Profit Market")).toEqual({ kind: "tp", label: "Take profit" });
    expect(orderKind("Stop Market")).toEqual({ kind: "sl", label: "Stop loss" });
    expect(orderKind("Limit")).toEqual({ kind: "limit", label: "Limit" });
  });

  it("says why Hyperliquid refused an order in plain words, and what to do", () => {
    expect(orderRefusal("Order could not immediately match against any resting orders. asset=0")).toBe("The price moved more than 1% before the order reached Hyperliquid, so nothing was traded. Try again.");
    expect(orderRefusal("Insufficient margin to place order. asset=3")).toBe("Your perps balance isn't enough for this order. Add money or lower the amount.");
    expect(orderRefusal("Order must have minimum value of $10. asset=0")).toBe("Orders must be worth at least $10. Add more or raise the leverage.");
    expect(orderRefusal("Reduce only order would increase position. asset=0")).toMatch(/^This would grow the position/);
    expect(orderRefusal("Order price cannot be more than 80% away from the reference price")).toBe("That price is too far from the price now. Pick one closer to it.");
    expect(orderRefusal("Something new happened. asset=12")).toBe("Hyperliquid didn't accept it: Something new happened.");
  });
});
