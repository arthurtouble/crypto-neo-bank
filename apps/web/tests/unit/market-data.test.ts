import { afterEach, describe, expect, it, vi } from "vitest";
import { getMarketHistory, getMarkets } from "@/lib/markets/data";

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

  it("rejects malformed provider history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: [], result: { "ETH/USD": [[1, "1", "2", "1", "bad", "1", "1", 1]], last: 1 } }))));
    await expect(getMarketHistory("ethereum", 30)).rejects.toThrow();
  });

  it("rejects unsafe asset identifiers and ranges", async () => {
    await expect(getMarketHistory("../ethereum", 30)).rejects.toThrow();
    await expect(getMarketHistory("ethereum", 999)).rejects.toThrow();
  });
});
