import { describe, expect, it } from "vitest";
import { loadObservedUsdPrices } from "@/lib/portfolio/prices";

const ETH = "8453:native";
const USDC = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const unknown = "8453:0x0000000000000000000000000000000000000001";
const day = "2026-09-20";
const timestamp = Date.parse(`${day}T00:00:00.000Z`) / 1000;
const row = (close: string, time = timestamp) => [time, "1", "2", "0.5", close, "1.1", "12", 15];
const now = () => Date.parse("2026-09-22T12:00:00.000Z");

describe("independent portfolio price observations", () => {
  it("keys price evidence to reviewed contracts and exact UTC daily candles", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      const pair = url.searchParams.get("pair");
      return Response.json({ error: [], result: { [pair === "ETHUSD" ? "XETHZUSD" : "USDCUSD"]: [row(pair === "ETHUSD" ? "4500.12" : "0.9987")], last: timestamp } });
    };
    const prices = await loadObservedUsdPrices([ETH, USDC, unknown], [day], { fetcher, now });
    expect(prices.map((item) => [item.assetId, item.day, item.usd])).toEqual([[USDC, day, "0.9987"], [ETH, day, "4500.12"]]);
    expect(prices.every((item) => item.sourceId === "kraken-spot-ohlc" && item.version === 1)).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests.every((url) => new URL(url).searchParams.get("interval") === "1440")).toBe(true);
  });

  it("does not assume a stablecoin peg or carry a missing price forward", async () => {
    const fetcher: typeof fetch = async (input) => Response.json({ error: [], result: { [new URL(String(input)).searchParams.get("pair") === "ETHUSD" ? "XETHZUSD" : "USDCUSD"]: [row("1")], last: timestamp } });
    const prices = await loadObservedUsdPrices([USDC, unknown], ["2026-09-19", day], { fetcher, now });
    expect(prices).toEqual([expect.objectContaining({ assetId: USDC, day, usd: "1" })]);
  });

  it("drops unfinished, malformed, duplicate or wrong-pair observations", async () => {
    const fetcher: typeof fetch = async () => Response.json({ error: [], result: { XETHZUSD: [row("0"), row("4.2", Date.parse("2026-09-22T00:00:00.000Z") / 1000)], last: timestamp } });
    expect(await loadObservedUsdPrices([ETH], [day, "2026-09-22"], { fetcher, now })).toEqual([]);
    const duplicate: typeof fetch = async () => Response.json({ error: [], result: { XETHZUSD: [row("4.2"), row("4.3")], last: timestamp } });
    expect(await loadObservedUsdPrices([ETH], [day], { fetcher: duplicate, now })).toEqual([]);
    const wrong: typeof fetch = async () => Response.json({ error: [], result: { BTCUSD: [row("4.2")], last: timestamp } });
    expect(await loadObservedUsdPrices([ETH], [day], { fetcher: wrong, now })).toEqual([]);
  });

  it("fails closed on an upstream outage", async () => {
    await expect(loadObservedUsdPrices([ETH], [day], { fetcher: async () => { throw new Error("offline"); }, now })).rejects.toThrow(/unavailable/i);
  });
});
