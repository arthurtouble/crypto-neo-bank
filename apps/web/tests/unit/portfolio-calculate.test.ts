import { describe, expect, it } from "vitest";
import { calculatePortfolioDays } from "@/lib/portfolio/calculate";
import type { AccountId, DayCoverage, HistoricalEvent, PriceObservation } from "@/lib/portfolio/types";

const A = "8453:0x00000000000000000000000000000000000000a1" as AccountId;
const USDC = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const days = ["2026-09-19", "2026-09-20", "2026-09-21"];

function event(day: string, id: string, rawDelta: string, kind: HistoricalEvent["kind"]): HistoricalEvent {
  return { sourceId: "base-indexer", sourceName: "Blockscout", sourceEventId: id, ingestionVersion: 1, accountId: A,
    assetId: USDC, rawDelta, decimals: 6, kind, occurredAt: `${day}T10:00:00.000Z`, chainId: 8453, blockNumber: "123",
    blockHash: `0x${"1".repeat(64)}`, txHash: `0x${"2".repeat(64)}`, logIndex: 0, finality: "finalized", completeness: "complete",
    groupId: id, counterpartyAccountId: null, evidenceJson: "{}" };
}
function price(day: string, usd: string): PriceObservation { return { assetId: USDC, day, usd, sourceId: "kraken-spot-ohlc", observedAt: `${day}T23:59:59.000Z`, methodology: "USDCUSD:UTC-daily-close", version: 1 }; }
function cover(day: string, eventStatus: DayCoverage["eventStatus"] = "complete"): DayCoverage { return { day, accountId: A, sourceId: "base-indexer", eventStatus, priceStatus: "complete", reason: null }; }

describe("covered historical portfolio values", () => {
  it("values actual daily quantities and excludes external cash flow from TWR", () => {
    const result = calculatePortfolioDays({
      events: [event(days[0], "deposit", "100000000", "contribution"), event(days[2], "withdrawal", "-50000000", "withdrawal")],
      prices: [price(days[0], "1"), price(days[1], "1.1"), price(days[2], "1.1")],
      coverage: days.map((day) => cover(day)), calculationVersion: 1
    });
    expect(result.points.map((point) => point.netValueUsd)).toEqual(["100", "110", "55"]);
    expect(result.points.map((point) => point.twrIndex)).toEqual(["1", "1.1", "1.1"]);
  });

  it("breaks the return sequence on missing price or incomplete source coverage", () => {
    const input = { events: [event(days[0], "deposit", "100000000", "contribution")],
      prices: [price(days[0], "1"), price(days[2], "1.2")], coverage: days.map((day) => cover(day)), calculationVersion: 1 };
    const result = calculatePortfolioDays(input);
    expect(result.points.map((point) => point.netValueUsd)).toEqual(["100", null, "120"]);
    expect(result.points.map((point) => point.twrIndex)).toEqual(["1", null, null]);
    expect(result.points[1]).toMatchObject({ status: "partial", reasons: expect.arrayContaining(["missing_price"]) });
    const partial = calculatePortfolioDays({ ...input, coverage: [cover(days[0]), cover(days[1], "partial"), cover(days[2])] });
    expect(partial.points[1].netValueUsd).toBeNull();
  });

  it("does not publish a value from an unfinalized event or empty coverage", () => {
    const unfinalized = event(days[0], "pending", "100000000", "contribution");
    unfinalized.finality = "pending";
    const result = calculatePortfolioDays({ events: [unfinalized], prices: [price(days[0], "1")], coverage: [cover(days[0])], calculationVersion: 1 });
    expect(result.points[0]).toMatchObject({ netValueUsd: null, twrIndex: null, status: "partial" });
    expect(calculatePortfolioDays({ events: [], prices: [], coverage: [], calculationVersion: 1 }).points).toEqual([]);
  });

  it("subtracts debt, suppresses receipts, and requires every included account's source", () => {
    const debt = event(days[0], "debt", "-20000000", "borrow");
    debt.evidenceJson = '{"role":"liability"}';
    const receipt = event(days[0], "receipt", "50000000", "supply");
    receipt.evidenceJson = '{"role":"position_receipt"}';
    const secondAccount = event(days[0], "other", "10000000", "contribution");
    secondAccount.accountId = "8453:0x00000000000000000000000000000000000000b2" as AccountId;
    const incomplete = calculatePortfolioDays({ events: [event(days[0], "deposit", "100000000", "contribution"), debt, receipt, secondAccount], prices: [price(days[0], "1")], coverage: [cover(days[0])], calculationVersion: 1 });
    expect(incomplete.points[0]).toMatchObject({ netValueUsd: null, reasons: expect.arrayContaining(["missing_source_coverage"]) });
    const complete = calculatePortfolioDays({ events: [event(days[0], "deposit", "100000000", "contribution"), debt, receipt], prices: [price(days[0], "1")], coverage: [cover(days[0])], calculationVersion: 1 });
    expect(complete.points[0].netValueUsd).toBe("80");
  });

  it("rejects conflicting independent prices instead of choosing a favorable one", () => {
    const result = calculatePortfolioDays({ events: [event(days[0], "deposit", "100000000", "contribution")], prices: [price(days[0], "1"), price(days[0], "1.01")], coverage: [cover(days[0])], calculationVersion: 1 });
    expect(result.points[0]).toMatchObject({ netValueUsd: null, reasons: expect.arrayContaining(["missing_price"]) });
  });
});
