import { afterEach, describe, expect, it, vi } from "vitest";
import { getMarketHistory, getMarkets, getMarketsPage } from "@/lib/markets/data";

afterEach(() => vi.unstubAllGlobals());

describe("market data authority", () => {
  it("validates market rows before presenting them", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: [], result: { "ETH/USD": { c: ["2500", "1"], v: ["100", "200"], h: ["2550", "2600"], l: ["2450", "2400"], o: "2475" } } })))
    vi.stubGlobal("fetch", fetch);
    const rows = await getMarkets(1);
    expect(rows[0]?.id).toBe("eth-usd");
    expect(rows[0]?.total_volume).toBe(500_000);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("api.kraken.com/0/public/Ticker");
  });

  it("searches every returned market before pagination and reports the real page count", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: [], result: {
      "ETH/USD": { c: ["2500", "1"], v: ["100", "200"], h: ["2550", "2600"], l: ["2450", "2400"], o: "2475" },
      "AAVE/USD": { c: ["100", "1"], v: ["10", "20"], h: ["105", "110"], l: ["95", "90"], o: "99" }
    } }))));
    const page = await getMarketsPage(1, 1, "aave");
    expect(page.total).toBe(1);
    expect(page.markets.map((market) => market.symbol)).toEqual(["aave"]);
    expect((await getMarketsPage(2, 1, "aave")).markets).toEqual([]);
  });

  it("rejects malformed provider history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: [], result: { "ETH/USD": [[1, "1", "2", "1", "bad", "1", "1", 1]], last: 1 } }))));
    await expect(getMarketHistory("ethereum", 30)).rejects.toThrow();
  });

  it("rejects unsafe asset identifiers and ranges", async () => {
    await expect(getMarketHistory("../ethereum", 30)).rejects.toThrow();
    await expect(getMarketHistory("ethereum", 999)).rejects.toThrow();
  });
});
