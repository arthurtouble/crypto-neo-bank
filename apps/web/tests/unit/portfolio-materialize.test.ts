import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HistoricalEvent, PriceObservation } from "@/lib/portfolio/types";

const accountId = "8453:0x1111111111111111111111111111111111111111" as const;
const state = vi.hoisted(() => ({ prices: [] as PriceObservation[], priceCalls: 0 }));
vi.mock("@/lib/portfolio/prices", () => ({ loadObservedUsdPrices: async () => { state.priceCalls++; return state.prices; } }));
import { materializePortfolioDaily } from "@/lib/portfolio/materialize";
import { CURRENT_PUBLICATION_SQL } from "@/lib/portfolio/publication";

const raw: HistoricalEvent = { sourceId: "blockscout:8453", sourceName: "Blockscout Pro Base", sourceEventId: "first", ingestionVersion: 1, accountId, assetId: "8453:native", rawDelta: "1000000000000000000", decimals: 18, kind: "contribution", occurredAt: "2026-09-15T12:00:00Z", chainId: 8453, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, txHash: `0x${"b".repeat(64)}`, logIndex: null, finality: "finalized", completeness: "complete", groupId: null, counterpartyAccountId: null, evidenceJson: '{"sourceEvidenceVersion":3}' };
const checkpoints = ["blockscout:8453", "aave:v3:8453"].map((source_id) => ({ account_id: accountId, source_id, cursor: null, covered_from: "2023-01-01T00:00:00.000Z", covered_through: "2026-09-22T00:00:00.000Z", status: "complete", ingestion_version: 1, last_finalized_block: "100", last_finalized_hash: `0x${"a".repeat(64)}` }));
function database() {
  const store = { checkpointRows: [...checkpoints] as Record<string, unknown>[], eventRows: [] as Record<string, unknown>[], marker: null as Record<string, unknown> | null, rebuildHold: null as null | { rebuild_id: string }, dailyCount: 90, priorPrice: null as Record<string, unknown> | null, batches: [] as Array<Array<{ sql: string; values: unknown[] }>>, calls: [] as Array<{ sql: string; values: unknown[] }> };
  const db = { prepare(sql: string) { return { sql, values: [] as unknown[], bind(...values: unknown[]) { this.values = values; store.calls.push({ sql, values }); return this; }, async first() { if (sql.includes("portfolio_publications")) return store.marker; if (sql.includes("portfolio_rebuild_holds")) return store.rebuildHold; if (sql.includes("COUNT(*)") && sql.includes("portfolio_daily_results")) return { count: store.dailyCount }; if (sql.includes("portfolio_price_observations")) return store.priorPrice; return null; }, async all() { if (sql.includes("portfolio_source_checkpoints")) return { results: store.checkpointRows }; if (sql.includes("portfolio_events")) return { results: store.eventRows }; return { results: [] }; } }; }, async batch(statements: Array<{ sql: string; values: unknown[] }>) { store.batches.push(statements.map((item) => ({ sql: item.sql, values: item.values }))); return statements.map(() => ({ success: true, meta: { changes: 1 }, results: [] })); } };
  return { db: db as unknown as D1Database, store };
}
function eventRow(event: HistoricalEvent) { return { source_id: event.sourceId, source_event_id: event.sourceEventId, ingestion_version: event.ingestionVersion, account_id: event.accountId, asset_id: event.assetId, raw_delta: event.rawDelta, decimals: event.decimals, event_kind: event.kind, occurred_at: event.occurredAt, chain_id: event.chainId, block_number: event.blockNumber, block_hash: event.blockHash, tx_hash: event.txHash, log_index: event.logIndex, finality: event.finality, completeness: event.completeness, group_id: event.groupId, counterparty_account_id: event.counterpartyAccountId, evidence_json: event.evidenceJson }; }
const now = new Date("2026-09-22T12:00:00Z");
beforeEach(() => { state.priceCalls = 0; state.prices = Array.from({ length: 90 }, (_, index) => ({ assetId: "8453:native", day: new Date(Date.UTC(2026, 8, 22) - (90 - index) * 86_400_000).toISOString().slice(0, 10), usd: "2000", sourceId: "kraken-spot-ohlc", observedAt: "2026-09-22T10:00:00Z", methodology: "ETHUSD:UTC-daily-close", version: 1 })); });

describe("bounded portfolio daily publication", () => {
  it("uses the same source-evidence gate for published history and tax reads", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec("CREATE TABLE portfolio_publications (subject_reference TEXT PRIMARY KEY, calculation_version INTEGER, status TEXT); CREATE TABLE portfolio_rebuild_holds (subject_reference TEXT PRIMARY KEY); CREATE TABLE portfolio_events (subject_reference TEXT, source_id TEXT, evidence_json TEXT);");
      sqlite.prepare("INSERT INTO portfolio_publications VALUES (?, ?, ?)").run("subject-a", 3, "published");
      const insert = sqlite.prepare("INSERT INTO portfolio_events VALUES (?, ?, ?)");
      insert.run("subject-a", "blockscout:8453", "{}");
      expect(sqlite.prepare(CURRENT_PUBLICATION_SQL).get("subject-a")).toBeUndefined();
      sqlite.exec("DELETE FROM portfolio_events");
      insert.run("subject-a", "blockscout:8453", '{"sourceEvidenceVersion":2}');
      expect(sqlite.prepare(CURRENT_PUBLICATION_SQL).get("subject-a")).toBeUndefined();
      sqlite.exec("DELETE FROM portfolio_events");
      insert.run("subject-a", "blockscout:8453", '{"sourceEvidenceVersion":3}');
      expect(sqlite.prepare(CURRENT_PUBLICATION_SQL).get("subject-a")).toMatchObject({ calculation_version: 3 });
      insert.run("subject-a", "aave:v3:8453", '{"role":"protocol_activity"}');
      expect(sqlite.prepare(CURRENT_PUBLICATION_SQL).get("subject-a")).toBeUndefined();
      sqlite.exec("DELETE FROM portfolio_events WHERE source_id = 'aave:v3:8453'");
      insert.run("subject-a", "aave:v3:8453", '{"sourceEvidenceVersion":2,"effectProof":"canonical_aave_pool_log"}');
      expect(sqlite.prepare(CURRENT_PUBLICATION_SQL).get("subject-a")).toBeUndefined();
      sqlite.exec("DELETE FROM portfolio_events WHERE source_id = 'aave:v3:8453'");
      insert.run("subject-a", "aave:v3:8453", '{"sourceEvidenceVersion":3,"effectProof":"canonical_aave_pool_log"}');
      expect(sqlite.prepare(CURRENT_PUBLICATION_SQL).get("subject-a")).toMatchObject({ calculation_version: 3 });
      insert.run("subject-a", "blockscout:8453", "malformed");
      expect(sqlite.prepare(CURRENT_PUBLICATION_SQL).get("subject-a")).toBeUndefined();
    } finally { sqlite.close(); }
  });
  it("holds pre-upgrade finalized history until a subject-scoped source replay", async () => {
    const { db, store } = database();
    store.marker = { input_digest: "prior-published-digest", calculation_version: 3 };
    store.eventRows = [eventRow({ ...raw, evidenceJson: '{"sourceEvidenceVersion":2}' })];
    await expect(materializePortfolioDaily(db, "subject-a", [accountId], { now })).rejects.toMatchObject({ code: "incomplete_event" });
    expect(state.priceCalls).toBe(0);
    expect(store.batches).toHaveLength(0);
  });
  it("holds old Aave activity until exact Pool events are replayed", async () => {
    const { db, store } = database();
    store.eventRows = [eventRow(raw), eventRow({ ...raw, sourceId: "aave:v3:8453", sourceEventId: "old-protocol", kind: "supply", evidenceJson: '{"role":"protocol_activity"}' })];
    await expect(materializePortfolioDaily(db, "subject-a", [accountId], { now })).rejects.toMatchObject({ code: "incomplete_event" });
    expect(state.priceCalls).toBe(0);
    expect(store.batches).toHaveLength(0);
  });
  it("refuses incomplete source checkpoints without writing a daily projection", async () => {
    const { db, store } = database();
    store.checkpointRows.pop();
    await expect(materializePortfolioDaily(db, "subject-a", [accountId], { now })).rejects.toMatchObject({ code: "incomplete_source" });
    expect(store.batches).toHaveLength(0);
  });

  it("refuses a truncated event scan before pricing or publication", async () => {
    const { db, store } = database();
    store.eventRows = Array.from({ length: 1001 }, (_, index) => ({ ...eventRow(raw), source_event_id: `event-${index}` }));
    await expect(materializePortfolioDaily(db, "subject-a", [accountId], { now })).rejects.toMatchObject({ code: "workload_exceeded" });
    expect(state.priceCalls).toBe(0);
    expect(store.batches).toHaveLength(0);
  });

  it("refuses a revised price under an already persisted source version", async () => {
    const { db, store } = database();
    store.eventRows = [eventRow(raw)];
    store.priorPrice = { usd: "1900", methodology: "ETHUSD:UTC-daily-close" };
    await expect(materializePortfolioDaily(db, "subject-a", [accountId], { now })).rejects.toMatchObject({ code: "price_unavailable" });
    expect(store.batches).toHaveLength(0);
  });

  it("keeps the atomic statement batch below D1's per-invocation query budget", async () => {
    const { db, store } = database();
    store.eventRows = Array.from({ length: 800 }, (_, index) => eventRow({ ...raw, sourceEventId: `lot-${index}`, rawDelta: "1" }));
    await expect(materializePortfolioDaily(db, "subject-a", [accountId], { now })).rejects.toMatchObject({ code: "workload_exceeded" });
    expect(store.batches).toHaveLength(0);
  });

  it("replays raw history, then atomically writes observed prices, quantities, coverage, basis, and a marker", async () => {
    const { db, store } = database();
    store.eventRows = [eventRow(raw)];
    const result = await materializePortfolioDaily(db, "subject-a", [accountId], { now });
    expect(result.status).toBe("published");
    expect(result.calculationVersion).toBe(1);
    expect(result.returnWindow).toEqual({ pricedDays: 90, scope: "recent_completed_utc_days", inceptionReturnAvailable: false });
    expect(result.days).toBe(90);
    expect(store.batches).toHaveLength(1);
    const statements = store.batches[0];
    expect(statements.some((item) => item.sql.includes("INSERT INTO portfolio_price_observations"))).toBe(true);
    expect(statements.some((item) => item.sql.includes("INSERT INTO portfolio_daily_quantities") && item.values.includes("1000000000000000000"))).toBe(true);
    const day = statements.find((item) => item.sql.includes("INSERT INTO portfolio_daily_results") && item.values.includes("2026-09-15"));
    expect(day?.values).toContain("2000");
    const coverage = JSON.parse(String(day?.values.find((value) => typeof value === "string" && value.startsWith("[")))) as Array<{ sourceId: string; eventStatus: string; priceStatus: string }>;
    expect(coverage).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: "blockscout:8453", eventStatus: "complete", priceStatus: "complete" }), expect.objectContaining({ sourceId: "aave:v3:8453", eventStatus: "complete", priceStatus: "complete" })]));
    expect(statements.at(-1)?.sql).toContain("portfolio_publications");
    expect(store.calls.filter((call) => !call.sql.includes("portfolio_price_observations")).every((call) => call.values.includes("subject-a"))).toBe(true);
  });

  it("publishes 90 values for four two-asset accounts within the atomic statement budget", async () => {
    const { db, store } = database();
    const accounts = ["1", "2", "3", "4"].map((digit) => `8453:0x${digit.repeat(40)}` as typeof accountId);
    store.checkpointRows = accounts.flatMap((account_id) => checkpoints.map((checkpoint) => ({ ...checkpoint, account_id })));
    store.eventRows = accounts.flatMap((address, index) => [
      eventRow({ ...raw, accountId: address, sourceEventId: `eth-${index}`, occurredAt: "2026-06-24T12:00:00Z" }),
      eventRow({ ...raw, accountId: address, sourceEventId: `usdc-${index}`, occurredAt: "2026-06-24T12:00:00Z", assetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", rawDelta: "1000000", decimals: 6 })
    ]);
    state.prices.push(...state.prices.map((price) => ({ ...price, assetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", usd: "1", methodology: "USDCUSD:UTC-daily-close" })));
    const result = await materializePortfolioDaily(db, "subject-a", accounts, { now });
    const statements = store.batches[0];
    expect(result.days).toBe(90);
    expect(statements.length).toBeLessThanOrEqual(800);
    expect(statements.filter((item) => item.sql.includes("INSERT INTO portfolio_daily_results"))).toHaveLength(90);
    const quantities = statements.filter((item) => item.sql.includes("INSERT INTO portfolio_daily_quantities"));
    expect(quantities).toHaveLength(4 * 2 * 30);
    expect(quantities[0].values[3]).toBe("2026-08-23");
    expect(quantities.at(-1)?.values[3]).toBe("2026-09-21");
  });

  it("marks protocol activity partial and does not double-count an Aave quantity", async () => {
    const { db, store } = database();
    store.eventRows = [eventRow(raw), eventRow({ ...raw, sourceId: "aave:v3:8453", sourceEventId: "protocol-1", ingestionVersion: 3, occurredAt: "2026-09-16T12:00:00Z", rawDelta: "1000000000000000000", kind: "supply", evidenceJson: '{"sourceEvidenceVersion":3,"effectProof":"canonical_aave_pool_log","role":"protocol_activity"}' })];
    await materializePortfolioDaily(db, "subject-a", [accountId], { now });
    const statements = store.batches[0];
    const day = statements.find((item) => item.sql.includes("INSERT INTO portfolio_daily_results") && item.values.includes("2026-09-16"));
    expect(day?.values).toContain(null);
    expect(JSON.stringify(day?.values)).toContain("protocol_position_history_unavailable");
    expect(statements.filter((item) => item.sql.includes("INSERT INTO portfolio_daily_quantities") && item.values.includes("2026-09-16")).every((item) => !item.values.includes("2000000000000000000"))).toBe(true);
  });

  it("uses an input digest to make repeats idempotent and never overwrites version one", async () => {
    const { db, store } = database();
    store.eventRows = [eventRow(raw)];
    const first = await materializePortfolioDaily(db, "subject-a", [accountId], { now });
    store.marker = { input_digest: first.inputDigest, calculation_version: first.calculationVersion };
    const repeated = await materializePortfolioDaily(db, "subject-a", [accountId], { now });
    expect(repeated.status).toBe("unchanged");
    expect(store.batches).toHaveLength(1);
    store.eventRows = [eventRow(raw), eventRow({ ...raw, sourceEventId: "reward", occurredAt: "2026-09-17T12:00:00Z", rawDelta: "1", kind: "reward" })];
    const changed = await materializePortfolioDaily(db, "subject-a", [accountId], { now });
    expect(changed.calculationVersion).toBe(2);
    expect(store.batches).toHaveLength(2);
    expect(store.batches[1].every((item) => !item.sql.includes("REPLACE INTO") && !item.sql.includes("DELETE FROM portfolio_daily_results"))).toBe(true);
  });

  it("republishes when a legacy rebuild left the marker but erased its daily rows", async () => {
    const { db, store } = database();
    store.eventRows = [eventRow(raw)];
    const first = await materializePortfolioDaily(db, "subject-a", [accountId], { now });
    store.marker = { input_digest: first.inputDigest, calculation_version: 1 };
    store.dailyCount = 0;
    const second = await materializePortfolioDaily(db, "subject-a", [accountId], { now });
    expect(second.status).toBe("published");
    expect(second.calculationVersion).toBe(2);
    expect(store.batches).toHaveLength(2);
  });

  it("republishes the same digest under a rebuild hold and releases it in the publication batch", async () => {
    const { db, store } = database();
    store.eventRows = [eventRow(raw)];
    const first = await materializePortfolioDaily(db, "subject-a", [accountId], { now });
    store.marker = { input_digest: first.inputDigest, calculation_version: 1 };
    store.rebuildHold = { rebuild_id: "replay-1" };
    const second = await materializePortfolioDaily(db, "subject-a", [accountId], { now });
    expect(second.status).toBe("published");
    expect(second.calculationVersion).toBe(2);
    expect(store.batches.at(-1)?.some((item) => item.sql.includes("DELETE FROM portfolio_rebuild_holds") && item.values.includes("replay-1"))).toBe(true);
  });

  it("rolls back every derived insert when publication CAS loses a concurrent race", async () => {
    const { db, store } = database();
    store.eventRows = [eventRow(raw)];
    const first = await materializePortfolioDaily(db, "subject-a", [accountId], { now });
    store.marker = { input_digest: first.inputDigest, calculation_version: 1 };
    store.eventRows.push(eventRow({ ...raw, sourceEventId: "new", rawDelta: "1" }));
    await materializePortfolioDaily(db, "subject-a", [accountId], { now });
    const markerStatement = store.batches[1].at(-1)!;
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0017_portfolio_analytics.sql"), "utf8"));
      sqlite.exec(readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0019_portfolio_publications.sql"), "utf8"));
      sqlite.prepare("INSERT INTO portfolio_publications VALUES (?, ?, ?, ?, ?, ?, ?)").run("subject-a", "concurrent-digest", 1, "2026-09-15", "2026-09-21", "published", now.toISOString());
      sqlite.exec("BEGIN");
      sqlite.prepare("INSERT INTO portfolio_daily_results VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("subject-a", "2026-09-15", 2, "2000", "1", "complete", "[]", now.toISOString());
      expect(() => sqlite.prepare(markerStatement.sql).run(...markerStatement.values.map((value) => value as string | number | null))).toThrow();
      sqlite.exec("ROLLBACK");
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM portfolio_daily_results WHERE calculation_version = 2").get()).toMatchObject({ count: 0 });
      expect(sqlite.prepare("SELECT input_digest FROM portfolio_publications WHERE subject_reference = ?").get("subject-a")).toMatchObject({ input_digest: "concurrent-digest" });
    } finally { sqlite.close(); }
  });

  it("makes same-version observed prices immutable even under a concurrent insert race", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0017_portfolio_analytics.sql"), "utf8"));
      sqlite.exec(readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0019_portfolio_publications.sql"), "utf8"));
      sqlite.prepare("INSERT INTO portfolio_price_observations VALUES (?, ?, ?, ?, ?, ?, ?)").run("8453:native", "2026-09-15", "kraken-spot-ohlc", 1, "1900", "ETHUSD:UTC-daily-close", now.toISOString());
      expect(() => sqlite.prepare(`INSERT INTO portfolio_price_observations VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id, day, source_id, version) DO NOTHING`).run("8453:native", "2026-09-15", "kraken-spot-ohlc", 1, "2000", "ETHUSD:UTC-daily-close", now.toISOString())).toThrow();
      expect(sqlite.prepare("SELECT usd FROM portfolio_price_observations WHERE asset_id = ? AND day = ?").get("8453:native", "2026-09-15")).toMatchObject({ usd: "1900" });
    } finally { sqlite.close(); }
  });
});
