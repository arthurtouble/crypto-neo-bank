import { describe, expect, it } from "vitest";
import {
  bookRows, clampLeverage, dayChangePercent, formatBookPrice, formatFee, formatSignedPrice, formatSize, formatSpreadPercent, PERP_RANGES, formatCents, formatChance, formatCompactUsd, formatFunding, formatPrice, formatSignedPercent, formatSignedUsd, parseDollars, parsePrice,
  payoutIfWins, perpDex, perpName, perpsTopUp, positionSide, PREDICTION_CATEGORIES, pressKey, shareOf, sourceLink
} from "@/lib/markets/view";

describe("Markets view helpers", () => {
  it("names a stock perp without its dex", () => {
    expect(perpName("xyz:SPCX")).toBe("SPCX");
    expect(perpDex("xyz:SPCX")).toBe("xyz");
    expect(perpName("BTC")).toBe("BTC");
    expect(perpDex("BTC")).toBeNull();
  });

  it("works out a day's change, and says nothing without both prices", () => {
    expect(dayChangePercent("110", "100")).toBeCloseTo(10);
    expect(dayChangePercent("90", 100)).toBeCloseTo(-10);
    expect(dayChangePercent("90", "0")).toBeNull();
    expect(dayChangePercent(null, "100")).toBeNull();
  });

  it("writes signed numbers with a true minus sign", () => {
    expect(formatSignedPercent(1.806)).toBe("+1.81%");
    expect(formatSignedPercent(-0.4)).toBe("−0.40%");
    expect(formatSignedPercent(0.001)).toBe("0.00%");
    expect(formatSignedUsd(3.5000000000000004)).toBe("+$3.50");
    expect(formatSignedUsd(-12)).toBe("−$12.00");
  });

  it("writes prices with the precision they need", () => {
    expect(formatPrice("64250")).toBe("$64,250.00");
    expect(formatPrice("148.625")).toBe("$148.625");
    expect(formatPrice("0.000123456")).toBe("$0.000123456");
    expect(formatPrice("x")).toBeNull();
    expect(formatCompactUsd(2_140_000_000)).toBe("$2.1B");
    expect(formatFunding("0.0001")).toBe("+0.0100%");
  });

  it("writes outcome prices as chances and cents", () => {
    expect(formatChance(0.634)).toBe("63%");
    expect(formatChance(0.004)).toBe("<1%");
    expect(formatChance(0.996)).toBe(">99%");
    expect(formatChance(null)).toBeNull();
    expect(formatCents(0.634)).toBe("63.4¢");
    expect(formatCents(0.05)).toBe("5¢");
    expect(payoutIfWins(10, 0.64)).toBeCloseTo(15.625);
    expect(payoutIfWins(10, 1)).toBeNull();
  });

  it("tops the perps balance up by the shortfall and a dollar, at least the minimum", () => {
    expect(perpsTopUp(0)).toBe(0);
    expect(perpsTopUp(2)).toBe(6);
    expect(perpsTopUp(15)).toBe(16);
    expect(perpsTopUp(20.004)).toBe(21.01);
  });

  it("reads typed amounts and keypad presses", () => {
    expect(parseDollars("$1,250.5")).toBe(1250.5);
    expect(parseDollars("0")).toBeNull();
    expect(parseDollars("1.234")).toBeNull();
    expect(parsePrice("64250.5")).toBe("64250.5");
    expect(parsePrice("abc")).toBeNull();
    expect(["1", "0", ".", "5", "5", "5"].reduce(pressKey, "")).toBe("10.55");
    expect(pressKey("", ".")).toBe("0.");
    expect(pressKey("0", "7")).toBe("7");
    expect(pressKey("12", "delete")).toBe("1");
    expect(shareOf(100.555, 0.5)).toBe("50.27");
    expect(shareOf(0, 1)).toBe("");
  });

  it("builds the order book's rows: running totals in dollars and depth against the deeper side", () => {
    const rows = bookRows([{ price: "100", size: "1" }, { price: "99", size: "2" }], [{ price: "101", size: "1" }, { price: "102", size: "5" }, { price: "103", size: "9" }], 2);
    expect(rows.bids.map((row) => row.total)).toEqual([100, 298]);
    expect(rows.asks.map((row) => row.total)).toEqual([101, 611]);
    expect(rows.asks[1].depth).toBe(1);
    expect(rows.bids[1].depth).toBeCloseTo(298 / 611);
    expect(bookRows([], [], 10)).toEqual({ bids: [], asks: [] });
  });

  it("writes the chart, book, and order numbers", () => {
    expect(PERP_RANGES.map((item) => item.label)).toEqual(["Live", "1H", "1D", "1W", "1M", "3M", "1Y", "All"]);
    expect(formatSignedPrice(1140)).toBe("+$1,140.00");
    expect(formatSignedPrice(-0.0123)).toBe("−$0.0123");
    expect(formatBookPrice("64250")).toBe("64,250.00");
    expect(formatSize("0.0015")).toBe("0.0015");
    expect(formatSize("1250.4")).toBe("1,250");
    expect(formatSpreadPercent("0.0016")).toBe("0.002%");
    expect(formatSpreadPercent(null)).toBeNull();
    expect(formatFee("0.0450")).toMatch(/^\$0\.0[45]$/);
    expect(formatFee("0.004")).toBe("<$0.01");
    expect(formatFee(null)).toBeNull();
    expect(clampLeverage(55, 40)).toBe(40);
    expect(clampLeverage(0, 40)).toBe(1);
    expect(clampLeverage(Number.NaN, 40)).toBe(1);
  });

  it("knows long from short, offers no sports category, and links only https sources", () => {
    expect(positionSide("-0.5")).toBe("short");
    expect(positionSide("0.5")).toBe("long");
    expect(PREDICTION_CATEGORIES.map((item) => item.label)).toEqual(["All", "Up or Down", "Politics", "Economy", "Crypto", "Tech", "Culture"]);
    expect(sourceLink("https://www.example.com/results")).toEqual({ href: "https://www.example.com/results", host: "example.com" });
    expect(sourceLink("javascript:alert(1)")).toBeNull();
    expect(sourceLink("The official results")).toBeNull();
  });
});
