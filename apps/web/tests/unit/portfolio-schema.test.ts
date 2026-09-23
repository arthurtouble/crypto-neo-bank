import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = () => readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0017_portfolio_analytics.sql"), "utf8");
const publicationMigrations = () => readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0019_portfolio_publications.sql"), "utf8")
  + readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0020_portfolio_rebuild_holds.sql"), "utf8");
const aaveReplayMigration = () => readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0027_aave_timestamp_replay.sql"), "utf8");

function sqlite(statements: string): string {
  return execFileSync("sqlite3", [":memory:"], { input: statements, encoding: "utf8" }).trim();
}

describe("disposable portfolio analytics schema", () => {
  it("creates the distinct source, coverage, price, quantity, result, and tax-support tables", () => {
    const names = sqlite(`${migration()}\nSELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'portfolio_%' ORDER BY name;`);
    expect(names.split("\n")).toEqual([
      "portfolio_daily_quantities", "portfolio_daily_results", "portfolio_disposals", "portfolio_events",
      "portfolio_lots", "portfolio_price_observations", "portfolio_source_checkpoints"
    ]);
  });

  it("keeps publication and replay holds in rebuildable analytics, separate from financial authority", () => {
    const names = sqlite(`${migration()}\n${publicationMigrations()}\nSELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'portfolio_%' ORDER BY name;`);
    expect(names.split("\n")).toContain("portfolio_publications");
    expect(names.split("\n")).toContain("portfolio_rebuild_holds");
  });

  it("can be removed without deleting durable controls, intent, consent, or audit evidence", () => {
    const retained = sqlite(`
      CREATE TABLE security_profiles (subject_reference TEXT PRIMARY KEY);
      CREATE TABLE transaction_intents (intent_id TEXT PRIMARY KEY);
      CREATE TABLE consent_evidence (consent_id TEXT PRIMARY KEY);
      CREATE TABLE audit_events (audit_id TEXT PRIMARY KEY);
      INSERT INTO security_profiles VALUES ('subject');
      INSERT INTO transaction_intents VALUES ('intent');
      INSERT INTO consent_evidence VALUES ('consent');
      INSERT INTO audit_events VALUES ('audit');
      ${migration()}
      DROP TABLE portfolio_disposals;
      DROP TABLE portfolio_lots;
      DROP TABLE portfolio_daily_results;
      DROP TABLE portfolio_daily_quantities;
      DROP TABLE portfolio_price_observations;
      DROP TABLE portfolio_source_checkpoints;
      DROP TABLE portfolio_events;
      SELECT (SELECT count(*) FROM security_profiles), (SELECT count(*) FROM transaction_intents),
             (SELECT count(*) FROM consent_evidence), (SELECT count(*) FROM audit_events);
    `);
    expect(retained).toBe("1|1|1|1");
  });

  it("holds existing publications and replays only Aave source evidence", () => {
    const outcome = sqlite(`${migration()}\n${publicationMigrations()}
      INSERT INTO portfolio_publications VALUES ('subject-a', 'old-digest', 1, '2026-09-01', '2026-09-20', 'published', '2026-09-21T00:00:00Z');
      INSERT INTO portfolio_publications VALUES ('subject-no-events', 'empty-digest', 1, '2026-09-01', '2026-09-20', 'published', '2026-09-21T00:00:00Z');
      INSERT INTO portfolio_source_checkpoints (subject_reference, account_id, source_id, ingestion_version, status, updated_at)
        VALUES ('subject-a', '8453:wallet', 'aave:v3:8453', 2, 'complete', '2026-09-21T00:00:00Z'),
               ('subject-a', '8453:wallet', 'blockscout:8453', 2, 'complete', '2026-09-21T00:00:00Z');
      INSERT INTO portfolio_events (subject_reference, source_id, source_event_id, ingestion_version, leg_index, account_id,
        asset_id, raw_delta, decimals, event_kind, occurred_at, finality, completeness, evidence_hash, evidence_json, observed_at)
        VALUES ('subject-a', 'aave:v3:8453', 'aave-old', 2, 0, '8453:wallet', '8453:asset', '1', 6, 'supply', '2026-09-20T00:00:00Z', 'finalized', 'complete', 'old', '{}', '2026-09-21T00:00:00Z'),
               ('subject-a', 'blockscout:8453', 'chain', 3, 0, '8453:wallet', '8453:asset', '1', 6, 'contribution', '2026-09-20T00:00:00Z', 'finalized', 'complete', 'chain', '{}', '2026-09-21T00:00:00Z');
      ${aaveReplayMigration()}
      SELECT (SELECT count(*) FROM portfolio_rebuild_holds WHERE subject_reference = 'subject-a'),
             (SELECT count(*) FROM portfolio_rebuild_holds WHERE subject_reference = 'subject-no-events'),
             (SELECT count(*) FROM portfolio_publications WHERE subject_reference = 'subject-a'),
             (SELECT count(*) FROM portfolio_source_checkpoints WHERE source_id = 'aave:v3:8453'),
             (SELECT count(*) FROM portfolio_source_checkpoints WHERE source_id = 'blockscout:8453'),
             (SELECT count(*) FROM portfolio_events WHERE source_id = 'aave:v3:8453'),
             (SELECT count(*) FROM portfolio_events WHERE source_id = 'blockscout:8453');`);
    expect(outcome).toBe("1|1|1|0|1|0|1");
  });
});
