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

  it("keeps an undocumented deposit and withdrawal out of supported tax gains", () => {
    const result = calculatePortfolioDays({
      events: [event(days[0], "deposit", "100000000", "contribution"), event(days[2], "withdraw", "-50000000", "withdrawal")],
      prices: days.map((day) => price(day, "1")), coverage: days.map((day) => cover(day)), calculationVersion: 2
    });
    expect(result.lots[0]).toMatchObject({ rawAcquired: "100000000", rawRemaining: "50000000", basisUsd: null, classification: "review_required", calculationVersion: 2 });
    expect(result.disposals[0]).toMatchObject({ rawUnits: "50000000", proceedsUsd: null, basisUsd: null, gainUsd: null, classification: "review_required" });
  });

  it("uses documented consideration for FIFO support and never daily closes as proceeds", () => {
    const first = event(days[0], "first", "100000000", "contribution");
    first.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"90","evidenceReference":"provider:1"}}';
    const second = event(days[1], "second", "100000000", "contribution");
    second.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"110","evidenceReference":"provider:2"}}';
    const sale = event(days[2], "sale", "-150000000", "swap");
    sale.evidenceJson = '{"taxSupport":{"disposalProceedsUsd":"180","evidenceReference":"provider:3"}}';
    const result = calculatePortfolioDays({ events: [first, second, sale], prices: days.map((day) => price(day, "1")), coverage: days.map((day) => cover(day)), calculationVersion: 2 });
    expect(result.lots.map((lot) => lot.rawRemaining)).toEqual(["0", "50000000"]);
    expect(result.disposals[0]).toMatchObject({ rawUnits: "150000000", proceedsUsd: "180", basisUsd: "145", gainUsd: "35", classification: "supported" });
  });

  it.each(["withdrawal", "internal_transfer", "fee", "unknown"] as const)(
    "keeps a %s debit as review-required evidence even if it carries a proceeds field",
    (kind) => {
      const acquisition = event(days[0], "acquisition", "100000000", "contribution");
      acquisition.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"100","evidenceReference":"provider:acquisition"}}';
      const debit = event(days[1], `${kind}-debit`, "-50000000", kind);
      debit.evidenceJson = '{"taxSupport":{"disposalProceedsUsd":"75","evidenceReference":"provider:debit"},"sourceDigest":"original-observation"}';
      const result = calculatePortfolioDays({ events: [acquisition, debit], prices: days.map((day) => price(day, "1")),
        coverage: days.map((day) => cover(day)), calculationVersion: 2 });
      expect(result.disposals).toHaveLength(1);
      expect(result.disposals[0]).toMatchObject({ sourceEventId: `base-indexer:${kind}-debit`, rawUnits: "50000000",
        proceedsUsd: null, gainUsd: null, classification: "review_required", evidenceJson: debit.evidenceJson });
    }
  );

  it("does not let an unrelated missing daily close erase documented tax basis", () => {
    const acquisition = event(days[0], "acquisition", "100000000", "contribution");
    acquisition.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"100","evidenceReference":"provider:acquisition"}}';
    const sale = event(days[2], "sale", "-50000000", "swap");
    sale.evidenceJson = '{"taxSupport":{"disposalProceedsUsd":"80","evidenceReference":"provider:sale"}}';
    const coverage = days.map((day) => day === days[1] ? { ...cover(day), priceStatus: "partial" as const, reason: "missing_price" } : cover(day));
    const result = calculatePortfolioDays({ events: [acquisition, sale], prices: [price(days[0], "1"), price(days[2], "1")], coverage, calculationVersion: 2 });
    expect(result.points[1].status).toBe("partial");
    expect(result.lots[0]).toMatchObject({ classification: "supported", basisUsd: "50" });
    expect(result.disposals[0]).toMatchObject({ classification: "supported", basisUsd: "50", proceedsUsd: "80", gainUsd: "30" });
  });

  it("moves basis between owned accounts without reporting a disposal", () => {
    const B = "8453:0x00000000000000000000000000000000000000b2" as AccountId;
    const initial = event(days[0], "initial", "100000000", "contribution");
    initial.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"100","evidenceReference":"provider:1"}}';
    const outgoing = event(days[1], "move-out", "-40000000", "internal_transfer");
    outgoing.groupId = "move";
    outgoing.counterpartyAccountId = B;
    const incoming = event(days[1], "move-in", "40000000", "internal_transfer");
    incoming.groupId = "move";
    incoming.accountId = B;
    incoming.counterpartyAccountId = A;
    const result = calculatePortfolioDays({ events: [initial, outgoing, incoming], prices: days.map((day) => price(day, "1")),
      coverage: days.flatMap((day) => [cover(day), { ...cover(day), accountId: B }]), calculationVersion: 2 });
    expect(result.disposals).toEqual([]);
    expect(result.lots.filter((lot) => lot.accountId === A)[0]).toMatchObject({ rawRemaining: "60000000" });
    expect(result.lots.filter((lot) => lot.accountId === B)[0]).toMatchObject({ rawRemaining: "40000000", basisUsd: "40", classification: "supported" });
  });

  it("attaches transferred FIFO basis to the matching log when equal transfers share a transaction", () => {
    const B = "8453:0x00000000000000000000000000000000000000b2" as AccountId;
    const first = event(days[0], "first", "2000000", "contribution");
    first.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"1","evidenceReference":"provider:first"}}';
    const second = event(days[0], "second", "2000000", "contribution");
    second.occurredAt = `${days[0]}T11:00:00.000Z`;
    second.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"3","evidenceReference":"provider:second"}}';
    const outgoing1 = event(days[1], "out-1", "-2000000", "internal_transfer");
    outgoing1.groupId = "same-tx"; outgoing1.logIndex = 1; outgoing1.counterpartyAccountId = B;
    const outgoing2 = event(days[1], "out-2", "-2000000", "internal_transfer");
    outgoing2.groupId = "same-tx"; outgoing2.logIndex = 2; outgoing2.counterpartyAccountId = B;
    const incoming2 = event(days[1], "in-a-log-2", "2000000", "internal_transfer");
    incoming2.groupId = "same-tx"; incoming2.logIndex = 2; incoming2.accountId = B; incoming2.counterpartyAccountId = A;
    const incoming1 = event(days[1], "in-z-log-1", "2000000", "internal_transfer");
    incoming1.groupId = "same-tx"; incoming1.logIndex = 1; incoming1.accountId = B; incoming1.counterpartyAccountId = A;
    const result = calculatePortfolioDays({ events: [first, second, outgoing1, outgoing2, incoming2, incoming1],
      prices: days.map((day) => price(day, "1")), coverage: days.flatMap((day) => [cover(day), { ...cover(day), accountId: B }]), calculationVersion: 2 });
    expect(result.disposals).toEqual([]);
    expect(result.lots.find((lot) => lot.sourceEventId.endsWith("in-z-log-1:basis-0"))).toMatchObject({ basisUsd: "1" });
    expect(result.lots.find((lot) => lot.sourceEventId.endsWith("in-a-log-2:basis-0"))).toMatchObject({ basisUsd: "3" });
  });

  it("does not support basis for same-block transfers without transaction order evidence", () => {
    const B = "8453:0x00000000000000000000000000000000000000b2" as AccountId;
    const prior = event(days[0], "prior", "1000000", "contribution");
    prior.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"1","evidenceReference":"provider:prior"}}';
    const acquire = event(days[1], "m-acquire", "1000000", "contribution");
    acquire.txHash = `0x${"3".repeat(64)}`;
    acquire.groupId = "other-tx";
    acquire.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"3","evidenceReference":"provider:acquire"}}';
    const out = event(days[1], "z-out", "-2000000", "internal_transfer");
    out.groupId = "transfer-tx"; out.counterpartyAccountId = B;
    const incoming = event(days[1], "a-in", "2000000", "internal_transfer");
    incoming.groupId = "transfer-tx"; incoming.accountId = B; incoming.counterpartyAccountId = A;
    const coverage = days.flatMap((day) => [cover(day), { ...cover(day), accountId: B }]);
    const derived: Array<Array<{ sourceEventId: string; rawRemaining: string; classification: string }>> = [];
    const permutations = (items: HistoricalEvent[]): HistoricalEvent[][] => items.length === 0 ? [[]]
      : items.flatMap((item, index) => permutations(items.filter((_, other) => other !== index)).map((rest) => [item, ...rest]));
    for (const events of permutations([prior, acquire, out, incoming])) {
      const result = calculatePortfolioDays({ events, prices: days.map((day) => price(day, "1")), coverage, calculationVersion: 2 });
      expect(result.lots.filter((lot) => lot.accountId === B).every((lot) => lot.classification === "review_required" && lot.basisUsd === null)).toBe(true);
      derived.push(result.lots.map((lot) => ({ sourceEventId: lot.sourceEventId, rawRemaining: lot.rawRemaining, classification: lot.classification })));
    }
    for (const result of derived) expect(result).toEqual(derived[0]);
    const ordered = [prior, { ...acquire, evidenceJson: '{"transactionIndex":1,"taxSupport":{"acquisitionCostUsd":"3","evidenceReference":"provider:acquire"}}' },
      { ...out, evidenceJson: '{"transactionIndex":2}' }, { ...incoming, evidenceJson: '{"transactionIndex":2}' }];
    const supported = calculatePortfolioDays({ events: ordered, prices: days.map((day) => price(day, "1")), coverage, calculationVersion: 2 });
    expect(supported.lots.filter((lot) => lot.accountId === B).map((lot) => ({ basisUsd: lot.basisUsd, classification: lot.classification })))
      .toEqual([{ basisUsd: "1", classification: "supported" }, { basisUsd: "3", classification: "supported" }]);
  });

  it("withholds a competing swap gain when same-block transfer order is unknown", () => {
    const B = "8453:0x00000000000000000000000000000000000000b2" as AccountId;
    const first = event(days[0], "first-lot", "1000000", "contribution");
    first.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"1","evidenceReference":"provider:first"}}';
    const second = event(days[0], "second-lot", "1000000", "contribution");
    second.occurredAt = `${days[0]}T11:00:00.000Z`;
    second.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"3","evidenceReference":"provider:second"}}';
    const coverage = days.flatMap((day) => [cover(day), { ...cover(day), accountId: B }]);
    for (const [transferHash, swapHash] of [["3", "4"], ["4", "3"]]) {
      const outgoing = event(days[1], "transfer-out", "-1000000", "internal_transfer");
      outgoing.groupId = "transfer"; outgoing.counterpartyAccountId = B; outgoing.txHash = `0x${transferHash.repeat(64)}`;
      const incoming = { ...outgoing, sourceEventId: "transfer-in", accountId: B, rawDelta: "1000000", counterpartyAccountId: A };
      const sale = event(days[1], "sale", "-1000000", "swap");
      sale.groupId = "swap"; sale.txHash = `0x${swapHash.repeat(64)}`;
      sale.evidenceJson = '{"taxSupport":{"disposalProceedsUsd":"5","evidenceReference":"provider:sale"}}';
      const result = calculatePortfolioDays({ events: [first, second, outgoing, incoming, sale],
        prices: days.map((day) => price(day, "1")), coverage, calculationVersion: 3 });
      expect(result.disposals.find((item) => item.sourceEventId.endsWith(":sale"))).toMatchObject({
        proceedsUsd: "5", basisUsd: null, gainUsd: null, classification: "review_required"
      });
      expect(result.lots.filter((lot) => lot.accountId === B).every((lot) => lot.basisUsd === null)).toBe(true);
    }
  });

  it("does not promote gains when source coverage or event classification is incomplete", () => {
    const acquisition = event(days[0], "acquire", "100000000", "contribution");
    acquisition.evidenceJson = '{"taxSupport":{"acquisitionCostUsd":"100","evidenceReference":"provider:1"}}';
    const unknown = event(days[1], "unknown", "10000000", "unknown");
    const sale = event(days[2], "sale", "-50000000", "swap");
    sale.evidenceJson = '{"taxSupport":{"disposalProceedsUsd":"80","evidenceReference":"provider:2"}}';
    const result = calculatePortfolioDays({ events: [acquisition, unknown, sale], prices: days.map((day) => price(day, "1")),
      coverage: [cover(days[0]), cover(days[1], "partial"), cover(days[2])], calculationVersion: 2 });
    expect(result.disposals[0]).toMatchObject({ classification: "review_required", gainUsd: null });
  });

  it("never treats Aave activity as a liquid balance or invents returns from unknown flows", () => {
    const deposit = event(days[0], "deposit", "100000000", "contribution");
    const aave = event(days[1], "aave-borrow", "-20000000", "borrow");
    aave.sourceId = "aave:v3:8453";
    aave.evidenceJson = '{"role":"protocol_activity"}';
    const result = calculatePortfolioDays({ events: [deposit, aave], prices: days.map((day) => price(day, "1")), coverage: days.map((day) => cover(day)), calculationVersion: 2 });
    expect(result.points[1]).toMatchObject({ netValueUsd: null, twrIndex: null, reasons: expect.arrayContaining(["protocol_position_history_unavailable"]) });
    const unknown = event(days[1], "unknown-flow", "20000000", "unknown");
    const other = calculatePortfolioDays({ events: [deposit, unknown], prices: days.map((day) => price(day, "1")), coverage: days.map((day) => cover(day)), calculationVersion: 2 });
    expect(other.points[1].netValueUsd).toBe("120");
    expect(other.points[1].twrIndex).toBeNull();
  });
});
