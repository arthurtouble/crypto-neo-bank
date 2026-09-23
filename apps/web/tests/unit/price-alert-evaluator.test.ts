import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateAlertObservation } from "@/lib/swap/price-alert-evaluator";
import type { PriceObservation } from "@/lib/swap/reminder-decisions";

function d1(db: DatabaseSync, beforeBatch?: () => void): D1Database {
  const prepare = (sql: string) => ({ bind(...args: unknown[]) {
    const statement = db.prepare(sql);
    const values = args as Array<string | number | null>;
    return {
      async first() { return statement.get(...values) ?? null; },
      async all() { return { results: statement.all(...values) }; },
      async run() { const info = statement.run(...values); return { meta: { changes: Number(info.changes) } }; }
    };
  } });
  return { prepare, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    beforeBatch?.();
    db.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
}

const source = (price: string, instant: string, id: string): PriceObservation => ({
  pairId: "ETH/USD", baseAssetId: "8453:native", quoteAssetId: "iso4217:USD", quoteCurrency: "USD",
  mappingVersion: "kraken-posttrade-eth-usd-v1", price, sourceObservedAt: instant,
  fetchedAt: new Date(Date.parse(instant) + 1000).toISOString(), observationId: id,
  mappingReviewed: true, assetEligible: true, depegged: false
});
const at = new Date("2026-09-23T10:00:05Z");
let sqlite: DatabaseSync;
let database: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE subject_profiles(subject_reference TEXT PRIMARY KEY); CREATE TABLE audit_events(audit_id TEXT PRIMARY KEY,subject_reference TEXT,actor_type TEXT NOT NULL,actor_reference TEXT NOT NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_reference TEXT,evidence_json TEXT NOT NULL,occurred_at TEXT NOT NULL); INSERT INTO subject_profiles VALUES ('alice'),('bob');");
  sqlite.exec(readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0022_price_alerts_swap_reminders.sql"), "utf8"));
  sqlite.prepare(`INSERT INTO price_alerts (alert_id,subject_reference,pair_id,base_asset_id,quote_asset_id,quote_currency,mapping_version,direction,threshold_decimal,hysteresis_bps,cooldown_seconds,status,threshold_version,created_at,updated_at)
    VALUES ('alert-1','alice','ETH/USD','8453:native','iso4217:USD','USD','kraken-posttrade-eth-usd-v1','above','3000',100,0,'active',1,?,?)`).run(at.toISOString(), at.toISOString());
  database = d1(sqlite);
});
afterEach(() => sqlite.close());

describe("atomic provider-observed alert evaluation", () => {
  it("baselines, arms, then creates one price reminder without wallet authority", async () => {
    const first = await evaluateAlertObservation(database, "alice", "alert-1", source("3010", "2026-09-23T10:00:00.000001Z", "a"), at);
    expect(first).toMatchObject({ accepted: true, triggered: false });
    await evaluateAlertObservation(database, "alice", "alert-1", source("2960", "2026-09-23T10:00:00.000002Z", "b"), at);
    const crossed = await evaluateAlertObservation(database, "alice", "alert-1", source("3010", "2026-09-23T10:00:00.000003Z", "c"), at);
    expect(crossed).toMatchObject({ accepted: true, triggered: true });
    expect(sqlite.prepare("SELECT occurrence_id,observed_price_decimal,source_observed_at FROM swap_reminder_occurrences").get()).toMatchObject({ observed_price_decimal: "3010", source_observed_at: "2026-09-23T10:00:00.000003Z" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='swap.alert.triggered'").get()).toMatchObject({ n: 1 });
    expect(sqlite.prepare("SELECT last_source_observed_at,last_triggered_at FROM price_alerts WHERE alert_id='alert-1'").get()).toMatchObject({ last_source_observed_at: "2026-09-23T10:00:00.000003Z", last_triggered_at: "2026-09-23T10:00:00.000003Z" });
    expect(await evaluateAlertObservation(database, "alice", "alert-1", source("3010", "2026-09-23T10:00:00.000003Z", "c"), at)).toMatchObject({ accepted: false, triggered: false });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM swap_reminder_occurrences").get()).toMatchObject({ n: 1 });
  });

  it("rejects another subject, stale source, and untrusted mapping without changing state", async () => {
    expect(await evaluateAlertObservation(database, "bob", "alert-1", source("3010", "2026-09-23T10:00:00Z", "a"), at)).toBeNull();
    expect(await evaluateAlertObservation(database, "alice", "alert-1", { ...source("3010", "2026-09-23T10:00:00Z", "a"), mappingReviewed: false }, at)).toMatchObject({ accepted: false, triggered: false });
    expect(sqlite.prepare("SELECT last_source_observed_at FROM price_alerts WHERE alert_id='alert-1'").get()).toMatchObject({ last_source_observed_at: null });
  });

  it("lets pause or threshold edit win over a stale evaluator read", async () => {
    database = d1(sqlite, () => sqlite.exec("UPDATE price_alerts SET status='paused',threshold_version=2 WHERE alert_id='alert-1'"));
    expect(await evaluateAlertObservation(database, "alice", "alert-1", source("2960", "2026-09-23T10:00:00Z", "a"), at)).toMatchObject({ accepted: false, triggered: false });
    expect(sqlite.prepare("SELECT last_source_observed_at FROM price_alerts WHERE alert_id='alert-1'").get()).toMatchObject({ last_source_observed_at: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM swap_reminder_occurrences").get()).toMatchObject({ n: 0 });
  });

  it("rolls back cursor and occurrence if audit storage fails", async () => {
    await evaluateAlertObservation(database, "alice", "alert-1", source("2960", "2026-09-23T10:00:00.000001Z", "a"), at);
    sqlite.exec("CREATE TRIGGER reject_alert_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END;");
    await expect(evaluateAlertObservation(database, "alice", "alert-1", source("3010", "2026-09-23T10:00:00.000002Z", "b"), at)).rejects.toThrow(/audit unavailable/);
    expect(sqlite.prepare("SELECT last_source_observed_at FROM price_alerts WHERE alert_id='alert-1'").get()).toMatchObject({ last_source_observed_at: "2026-09-23T10:00:00.000001Z" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM swap_reminder_occurrences").get()).toMatchObject({ n: 0 });
  });
});
