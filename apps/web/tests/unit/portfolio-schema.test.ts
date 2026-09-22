import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = () => readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0017_portfolio_analytics.sql"), "utf8");

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
});
