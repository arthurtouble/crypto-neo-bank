import { describe, expect, it, vi } from "vitest";
import { getReviewedSpotObservation } from "@/lib/markets/price-observations";

const now = Date.parse("2026-09-23T12:00:05.000Z");
const selection = { pairId: "ETH/USD", baseAssetId: "8453:native", quoteAssetId: "iso4217:USD" };
const trade = (price = "3000.25", tradeTs = "2026-09-23T12:00:00.123456Z", tradeId = "TABC1-DEF2-GHI3") => ({
  trade_id: tradeId, price, quantity: "0.5", symbol: "ETH/USD", base_asset: "ETH", quote_asset: "USD",
  trade_ts: tradeTs, publication_ts: "2026-09-23T12:00:00.223456Z", trade_venue: "PGSL"
});
const payload = (trades: ReturnType<typeof trade>[]) => ({ error: [], result: { last_ts: trades.reduce((latest, item) => item.trade_ts > latest ? item.trade_ts : latest, ""), count: trades.length, trades } });
function fetcher(body: unknown): typeof fetch { return vi.fn(async () => Response.json(body)); }
const eligible = async () => true;

describe("reviewed provider-observed spot prices", () => {
  it("uses the trade event time and stable ID, not request completion time", async () => {
    const get = fetcher(payload([trade()]));
    const observation = await getReviewedSpotObservation(selection, { fetcher: get, now: () => now, checkEligibility: eligible });
    expect(observation).toMatchObject({ pairId: "ETH/USD", baseAssetId: "8453:native", quoteAssetId: "iso4217:USD",
      price: "3000.25", sourceObservedAt: "2026-09-23T12:00:00.123456Z", fetchedAt: "2026-09-23T12:00:05.000Z",
      observationId: "kraken:ETH/USD:TABC1-DEF2-GHI3", mappingReviewed: true, assetEligible: true, depegged: false });
    expect(String(vi.mocked(get).mock.calls[0][0])).toContain("/PostTrade?symbol=ETH%2FUSD&count=10");
  });

  it("takes the newest observed trade, not merely the last received row", async () => {
    const earlier = trade("2999", "2026-09-23T11:59:59.000Z", "EARLY");
    const later = { ...trade("3001", "2026-09-23T12:00:01.000Z", "LATER"), publication_ts: "2026-09-23T12:00:01.100Z" };
    const observation = await getReviewedSpotObservation(selection, { fetcher: fetcher(payload([later, earlier])), now: () => now, checkEligibility: eligible });
    expect(observation?.price).toBe("3001");
    expect(observation?.observationId).toContain("LATER");
  });

  it.each([
    { ...selection, baseAssetId: "1:native" },
    { ...selection, pairId: "BTC/USD" },
    { ...selection, quoteAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }
  ])("refuses an unreviewed market-to-asset mapping", async (input) => {
    const get = fetcher(payload([trade()]));
    await expect(getReviewedSpotObservation(input, { fetcher: get, now: () => now })).rejects.toThrow(/mapping/);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    payload([trade("0")]),
    payload([trade("1.0000000000000000001")]),
    payload([{ ...trade(), symbol: "BTC/USD" }]),
    payload([{ ...trade(), trade_ts: "2026-09-23T12:00:10Z" }]),
    payload([{ ...trade(), publication_ts: "2026-09-23T11:59:59Z" }]),
    { error: ["EGeneral:Unavailable"], result: payload([trade()]).result },
    payload([])
  ])("fails closed for malformed or missing provider observations", async (body) => {
    await expect(getReviewedSpotObservation(selection, { fetcher: fetcher(body), now: () => now, checkEligibility: eligible })).rejects.toThrow();
  });

  it("preserves sub-millisecond order and rejects a mismatched provider cursor", async () => {
    const first = trade("3000", "2026-09-23T12:00:00.123456001Z", "FIRST");
    const last = trade("3001", "2026-09-23T12:00:00.123456002Z", "LAST");
    const body = payload([last, first]);
    const observation = await getReviewedSpotObservation(selection, { fetcher: fetcher(body), now: () => now, checkEligibility: eligible });
    expect(observation.sourceObservedAt).toBe(last.trade_ts);
    await expect(getReviewedSpotObservation(selection, { fetcher: fetcher({ ...body, result: { ...body.result, last_ts: first.trade_ts } }), now: () => now, checkEligibility: eligible })).rejects.toThrow(/cursor/);
  });

  it("fails closed when distinct trades share the newest source instant", async () => {
    const first = trade("2990", "2026-09-23T12:00:00.123456Z", "FIRST");
    const second = trade("3010", first.trade_ts, "SECOND");
    await expect(getReviewedSpotObservation(selection, { fetcher: fetcher(payload([first, second])), now: () => now, checkEligibility: eligible })).rejects.toThrow(/ambiguous/);
  });

  it("requires a live asset eligibility decision", async () => {
    const get = fetcher(payload([trade()]));
    await expect(getReviewedSpotObservation(selection, { fetcher: get, now: () => now })).rejects.toThrow(/eligib/i);
    await expect(getReviewedSpotObservation(selection, { fetcher: get, now: () => now, checkEligibility: async () => false })).rejects.toThrow(/eligib/i);
    await expect(getReviewedSpotObservation(selection, { fetcher: get, now: () => now, checkEligibility: async () => { throw new Error("down"); } })).rejects.toThrow(/eligib/i);
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects a stale latest trade and an incomplete provider page", async () => {
    const stale = { ...trade("3000", "2026-09-23T11:50:00Z"), publication_ts: "2026-09-23T11:50:01Z" };
    await expect(getReviewedSpotObservation(selection, { fetcher: fetcher(payload([stale])), now: () => now, checkEligibility: eligible })).rejects.toThrow(/stale/);
    await expect(getReviewedSpotObservation(selection, { fetcher: fetcher({ ...payload([trade()]), result: { ...payload([trade()]).result, count: 2 } }), now: () => now, checkEligibility: eligible })).rejects.toThrow(/incomplete/);
  });

  it("rejects an oversized response before parsing it", async () => {
    const get = vi.fn(async () => new Response("x".repeat(128_001)));
    await expect(getReviewedSpotObservation(selection, { fetcher: get, now: () => now, checkEligibility: eligible })).rejects.toThrow(/oversized/);
  });
});
