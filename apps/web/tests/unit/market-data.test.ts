import { afterEach, describe, expect, it, vi } from "vitest";
import { getMarketHistory, getMarkets } from "@/lib/markets/data";

afterEach(() => vi.unstubAllGlobals());

describe("market data authority", () => {
  it("validates market rows before presenting them", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "ethereum", symbol: "eth", name: "Ethereum", image: "https://example.com/eth.png", current_price: 2500, market_cap: 300_000_000_000, market_cap_rank: 2, total_volume: 10_000_000, price_change_percentage_24h: 1.2, sparkline_in_7d: { price: [2400, 2500] }, last_updated: "2026-09-22T00:00:00Z" }])))
    vi.stubGlobal("fetch", fetch);
    const rows = await getMarkets(1);
    expect(rows[0]?.id).toBe("ethereum");
    expect(String(fetch.mock.calls[0]?.[0])).toContain("include_rehypothecated=true");
  });

  it("rejects malformed provider history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ prices: [["bad", 2500]] }))));
    await expect(getMarketHistory("ethereum", 30)).rejects.toThrow();
  });

  it("rejects unsafe asset identifiers and ranges", async () => {
    await expect(getMarketHistory("../ethereum", 30)).rejects.toThrow();
    await expect(getMarketHistory("ethereum", 999)).rejects.toThrow();
  });
});
