import { describe, expect, it, vi } from "vitest";
import { ingestOnePage, PortfolioIngestError } from "@/lib/portfolio/ingest";
import { rebuildPortfolioAnalytics, invalidateFromBlock } from "@/lib/portfolio/store";
import type { HistoricalEvent, HistoricalEventSource } from "@/lib/portfolio/types";

const accountId = "8453:0x1111111111111111111111111111111111111111" as const;
const event: HistoricalEvent = { sourceId: "blockscout:8453", sourceName: "Blockscout Pro Base", sourceEventId: "tx:1:out", ingestionVersion: 1, accountId, assetId: "8453:native", rawDelta: "-100", decimals: 18, kind: "unknown", occurredAt: "2026-09-20T12:00:00Z", chainId: 8453, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, txHash: `0x${"b".repeat(64)}`, logIndex: null, finality: "finalized", completeness: "complete", groupId: null, counterpartyAccountId: null, evidenceJson: "{}" };

function fakeDb() {
  const state = { checkpoint: null as null | Record<string, unknown>, priorEvent: null as null | { block_hash: string; block_number: string }, events: new Map<string, unknown[]>(), batches: 0, failBatch: false, queries: [] as string[], bound: [] as unknown[][] };
  const db = {
    prepare(query: string) {
      state.queries.push(query);
      const statement = { query, values: [] as unknown[], bind(...values: unknown[]) { this.values = values; state.bound.push(values); return this; },
        async first() { if (query.includes("portfolio_source_checkpoints")) return state.checkpoint; if (query.includes("portfolio_events")) return state.priorEvent; return null; },
        async all() { return { results: [] }; } };
      return statement;
    },
    async batch(statements: Array<{ query: string; values: unknown[] }>) {
      state.batches++;
      if (state.failBatch) throw Error("disk failure");
      for (const statement of statements) {
        if (statement.query.includes("INSERT INTO portfolio_events")) state.events.set(String(statement.values[2]), statement.values);
        if (statement.query.includes("INSERT INTO portfolio_source_checkpoints")) state.checkpoint = { cursor: statement.values[3], covered_from: statement.values[4], covered_through: statement.values[5], status: statement.values[9] };
      }
      return statements.map(() => ({ success: true, meta: { changes: 1 }, results: [] }));
    }
  };
  return { db: db as unknown as D1Database, state };
}

describe("bounded portfolio ingestion", () => {
  it("stores one page and server-issued checkpoint together; replay cannot duplicate or forge coverage", async () => {
    const { db, state } = fakeDb();
    const source: HistoricalEventSource = { sourceId: "blockscout:8453", page: vi.fn(async () => ({ events: [event], nextCursor: "provider-next", coveredThrough: "2023-01-01T00:00:00Z", complete: false, sourceId: "blockscout:8453" })) };
    const first = await ingestOnePage(db, "subject-a", accountId, source, null, { now: new Date("2026-09-22T12:00:00Z") });
    expect(first.status).toBe("partial");
    expect(first.nextCursor).not.toBe("provider-next");
    expect(state.events.size).toBe(1);
    expect(state.checkpoint?.cursor).toBe(first.nextCursor);
    await expect(ingestOnePage(db, "subject-a", accountId, source, "forged", { now: new Date("2026-09-22T12:00:00Z") })).rejects.toBeInstanceOf(PortfolioIngestError);
    expect(state.events.size).toBe(1);
  });

  it("preserves the prior checkpoint on source outage, repeated cursor, and batch failure", async () => {
    const { db, state } = fakeDb();
    const outage: HistoricalEventSource = { sourceId: "blockscout:8453", page: async () => { throw Error("offline"); } };
    await expect(ingestOnePage(db, "subject-a", accountId, outage, null)).rejects.toBeInstanceOf(PortfolioIngestError);
    expect(state.batches).toBe(0);
    const looping: HistoricalEventSource = { sourceId: "blockscout:8453", page: async () => ({ events: [], nextCursor: "same", coveredThrough: "2023-01-01T00:00:00Z", complete: false, sourceId: "blockscout:8453" }) };
    state.checkpoint = { cursor: JSON.stringify({ token: "old", sourceCursor: "same", from: "2023-01-01T00:00:00Z", through: "2026-09-22T11:55:00.000Z" }), covered_from: "2023-01-01T00:00:00Z", covered_through: null, status: "partial" };
    await expect(ingestOnePage(db, "subject-a", accountId, looping, "old", { now: new Date("2026-09-22T12:00:00Z") })).rejects.toBeInstanceOf(PortfolioIngestError);
    expect(state.batches).toBe(0);
    state.checkpoint = null;
    state.failBatch = true;
    const source: HistoricalEventSource = { sourceId: "blockscout:8453", page: async () => ({ events: [event], nextCursor: null, coveredThrough: "2026-09-22T11:55:00.000Z", complete: true, sourceId: "blockscout:8453" }) };
    await expect(ingestOnePage(db, "subject-a", accountId, source, null, { now: new Date("2026-09-22T12:00:00Z") })).rejects.toThrow();
    expect(state.events.size).toBe(0);
    expect(state.checkpoint).toBeNull();
  });

  it("wipes only subject analytics and invalidates derived days on reorg", async () => {
    const { db, state } = fakeDb();
    await rebuildPortfolioAnalytics(db, "subject-a");
    expect(state.queries.filter((sql) => sql.startsWith("DELETE"))).toHaveLength(6);
    expect(state.queries.some((sql) => sql.includes("transaction_intents"))).toBe(false);
    await invalidateFromBlock(db, "subject-a", 8453, "100");
    expect(state.queries.some((sql) => sql.includes("portfolio_daily_results"))).toBe(true);
  });

  it("rewinds from the earlier block when an observed event moves in a reorg", async () => {
    const { db, state } = fakeDb();
    state.priorEvent = { block_hash: `0x${"c".repeat(64)}`, block_number: "90" };
    const source: HistoricalEventSource = { sourceId: "blockscout:8453", page: async () => ({ events: [event], nextCursor: null, coveredThrough: "2026-09-22T11:55:00.000Z", complete: true, sourceId: "blockscout:8453" }) };
    await expect(ingestOnePage(db, "subject-a", accountId, source, null, { now: new Date("2026-09-22T12:00:00Z") })).rejects.toMatchObject({ code: "reorg" });
    expect(state.queries.some((sql) => sql.includes("UPDATE portfolio_events SET finality = 'reorged'"))).toBe(true);
    expect(state.bound.some((values) => values.includes("90"))).toBe(true);
  });

  it("rewinds to the previously stored block when a source reports a moved event", async () => {
    const { db, state } = fakeDb();
    state.priorEvent = { block_hash: `0x${"c".repeat(64)}`, block_number: "90" };
    const moved: HistoricalEvent = { ...event, finality: "reorged", completeness: "partial", blockNumber: "100" };
    const source: HistoricalEventSource = { sourceId: "blockscout:8453", page: async () => ({ events: [moved], nextCursor: null, coveredThrough: "2023-01-01T00:00:00Z", complete: false, sourceId: "blockscout:8453" }) };
    await expect(ingestOnePage(db, "subject-a", accountId, source, null)).rejects.toMatchObject({ code: "reorg" });
    expect(state.bound.some((values) => values.includes("90"))).toBe(true);
  });
});
