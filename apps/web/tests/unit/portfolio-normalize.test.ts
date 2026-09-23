import { describe, expect, it } from "vitest";
import { foldDailyQuantities, normalizeEconomicEvents } from "@/lib/portfolio/normalize";
import type { AccountId, HistoricalEvent } from "@/lib/portfolio/types";

const A = "8453:0x00000000000000000000000000000000000000a1" as AccountId;
const B = "8453:0x00000000000000000000000000000000000000b2" as AccountId;
const USDC = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function event(id: string, rawDelta: string, overrides: Partial<HistoricalEvent> = {}): HistoricalEvent {
  return { sourceId: "base-indexer", sourceName: "Blockscout", sourceEventId: id, ingestionVersion: 1,
    accountId: A, assetId: USDC, rawDelta, decimals: 6, kind: "unknown", occurredAt: "2026-09-21T10:00:00.000Z",
    chainId: 8453, blockNumber: "123", blockHash: `0x${"1".repeat(64)}`, txHash: `0x${"2".repeat(64)}`,
    logIndex: 0, finality: "finalized", completeness: "complete", groupId: "tx-1", counterpartyAccountId: null,
    evidenceJson: "{}", ...overrides };
}

describe("portfolio event normalization", () => {
  it("pairs internal transfers without calling either side an external flow", () => {
    const outgoing = event("tx:0", "-2000000", { counterpartyAccountId: B });
    const incoming = event("tx:1", "2000000", { accountId: B, counterpartyAccountId: A });
    const result = normalizeEconomicEvents([incoming, outgoing], new Set([A, B]));
    expect(result.unresolved).toEqual([]);
    expect(result.events.map((row) => row.kind)).toEqual(["internal_transfer", "internal_transfer"]);
    expect([...foldDailyQuantities(result.events, new Map()).values()].sort()).toEqual([-2000000n, 2000000n]);
  });

  it("pairs repeated equal transfers by log position, not only transaction and amount", () => {
    const rows = [
      event("tx:log:1:out", "-2000000", { logIndex: 1, counterpartyAccountId: B }),
      event("tx:log:2:out", "-2000000", { logIndex: 2, counterpartyAccountId: B }),
      event("tx:log:1:in", "2000000", { logIndex: 1, accountId: B, counterpartyAccountId: A }),
      event("tx:log:2:in", "2000000", { logIndex: 2, accountId: B, counterpartyAccountId: A })
    ];
    const result = normalizeEconomicEvents(rows, new Set([A, B]));
    expect(result.unresolved).toEqual([]);
    expect(result.events.map((row) => row.kind)).toEqual(Array(4).fill("internal_transfer"));
  });

  it("does not pair transfer legs observed on different canonical blocks", () => {
    const outbound = event("move-out", "-2000000", { counterpartyAccountId: B });
    const inbound = event("move-in", "2000000", { accountId: B, counterpartyAccountId: A,
      blockHash: `0x${"3".repeat(64)}` });
    const result = normalizeEconomicEvents([outbound, inbound], new Set([A, B]));
    expect(result.unresolved).toHaveLength(2);
    expect(result.events.every((item) => item.kind === "unknown" && item.completeness === "partial")).toBe(true);
  });

  it("leaves an unmatched owned-wallet side incomplete until the other source page arrives", () => {
    const result = normalizeEconomicEvents([event("tx:0", "-2000000", { counterpartyAccountId: B })], new Set([A, B]));
    expect(result.events[0]).toMatchObject({ kind: "unknown", completeness: "partial" });
    expect(result.unresolved).toHaveLength(1);
    expect(() => foldDailyQuantities(result.events, new Map())).toThrow(/incomplete/i);
  });

  it("retains externally sourced contribution, withdrawal, swap, fee, reward and debt signs", () => {
    const rows = [
      event("deposit", "1000000", { kind: "contribution", groupId: "tx-a" }),
      event("withdraw", "-500000", { kind: "withdrawal", groupId: "tx-b" }),
      event("swap-input", "-100000", { kind: "swap", groupId: "tx-c" }),
      event("swap-output", "900000", { kind: "swap", groupId: "tx-c", assetId: "8453:native", decimals: 18 }),
      event("fee", "-1000", { kind: "fee", groupId: "tx-c" }),
      event("reward", "10000", { kind: "reward", groupId: "tx-d" }),
      event("debt", "-250000", { kind: "borrow", groupId: "tx-e", evidenceJson: '{"role":"liability"}' })
    ];
    const result = normalizeEconomicEvents(rows, new Set([A]));
    expect(result.unresolved).toEqual([]);
    const balances = foldDailyQuantities(result.events, new Map());
    expect(balances.get(`${A}|${USDC}`)).toBe(159000n);
    expect(balances.get(`${A}|8453:native`)).toBe(900000n);
  });

  it("suppresses position receipt tokens and fails on conflicting duplicate source effects", () => {
    const receipt = event("receipt", "1000000", { kind: "supply", evidenceJson: '{"role":"position_receipt"}' });
    const normalized = normalizeEconomicEvents([receipt], new Set([A]));
    expect(foldDailyQuantities(normalized.events, new Map())).toEqual(new Map());
    const conflict = normalizeEconomicEvents([event("same", "1"), event("same", "2")], new Set([A]));
    expect(conflict.events).toEqual([]);
    expect(conflict.unresolved).toHaveLength(1);
  });

  it("is deterministic across duplicate or reordered pages and refuses unfinalized data", () => {
    const first = event("b", "25", { groupId: "tx-b" });
    const second = event("a", "10", { groupId: "tx-a" });
    const left = normalizeEconomicEvents([first, second, first], new Set([A]));
    const right = normalizeEconomicEvents([second, first], new Set([A]));
    expect(left).toEqual(right);
    expect(foldDailyQuantities(left.events, new Map()).get(`${A}|${USDC}`)).toBe(35n);
    expect(() => foldDailyQuantities([event("pending", "1", { finality: "pending" })], new Map())).toThrow(/incomplete/i);
    expect(() => foldDailyQuantities([first, event("wrong-decimals", "1", { decimals: 18 })], new Map())).toThrow(/decimals/i);
  });
});
