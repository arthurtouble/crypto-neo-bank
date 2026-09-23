import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = () => readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0022_price_alerts_swap_reminders.sql"), "utf8");
const sqlite = (sql: string) => spawnSync("sqlite3", [":memory:"], { input: `PRAGMA foreign_keys=ON;\nCREATE TABLE subject_profiles(subject_reference TEXT PRIMARY KEY);\n${migration()}\n${sql}`, encoding: "utf8" });

const setup = `INSERT INTO subject_profiles VALUES ('alice'), ('bob');
INSERT INTO price_alerts (alert_id, subject_reference, pair_id, base_asset_id, quote_asset_id, quote_currency, mapping_version, direction, threshold_decimal, hysteresis_bps, cooldown_seconds, status, threshold_version, created_at, updated_at)
VALUES ('a1','alice','ETH/USD','eip155:8453/native','iso4217:USD','USD','catalog-1','above','3000',100,3600,'active',1,'2026-09-23T00:00:00Z','2026-09-23T00:00:00Z');
INSERT INTO swap_reminder_plans (plan_id, subject_reference, pair_id, base_asset_id, quote_asset_id, quote_currency, mapping_version, amount_decimal, schedule_type, time_zone, anchor_local, status, plan_version, created_at, updated_at)
VALUES ('p1','alice','ETH/USDC','eip155:8453/native','eip155:8453/erc20:0x1111111111111111111111111111111111111111','USD','catalog-1','10','weekly','Europe/Lisbon','2026-09-23T09:00','active',1,'2026-09-23T00:00:00Z','2026-09-23T00:00:00Z');`;

describe("price alert and Swap reminder migration", () => {
  it("creates subject-scoped, idempotent plan and alert occurrences", () => {
    const result = sqlite(`${setup}
INSERT INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,plan_id,plan_version,due_at,created_at) VALUES ('o1','alice','plan','p1',1,'2026-09-30T08:00:00Z','2026-09-23T00:00:00Z');
INSERT OR IGNORE INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,plan_id,plan_version,due_at,created_at) VALUES ('o2','alice','plan','p1',1,'2026-09-30T08:00:00Z','2026-09-23T00:00:00Z');
INSERT INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,alert_id,threshold_version,crossing_observation_id,observed_price_decimal,source_observed_at,created_at) VALUES ('o3','alice','alert','a1',1,'obs-1','3001','2026-09-23T10:00:00Z','2026-09-23T10:01:00Z');
INSERT OR IGNORE INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,alert_id,threshold_version,crossing_observation_id,observed_price_decimal,source_observed_at,created_at) VALUES ('o4','alice','alert','a1',1,'obs-1','3001','2026-09-23T10:00:00Z','2026-09-23T10:01:00Z');
SELECT COUNT(*) FROM swap_reminder_occurrences;`);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("2");
  });
  it("rejects cross-subject occurrence references and deletion of evidence", () => {
    const wrongSubject = sqlite(`${setup}\nINSERT INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,plan_id,plan_version,due_at,created_at) VALUES ('o1','bob','plan','p1',1,'2026-09-30T08:00:00Z','2026-09-23T00:00:00Z');`);
    expect(wrongSubject.status).not.toBe(0);
    const deletion = sqlite(`${setup}\nINSERT INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,plan_id,plan_version,due_at,created_at) VALUES ('o1','alice','plan','p1',1,'2026-09-30T08:00:00Z','2026-09-23T00:00:00Z');\nDELETE FROM swap_reminder_occurrences WHERE occurrence_id='o1';`);
    expect(deletion.status).not.toBe(0);
  });
  it("rejects malformed money and mixed alert/plan identity", () => {
    const badAmount = sqlite(`${setup}\nINSERT INTO swap_reminder_plans (plan_id,subject_reference,pair_id,base_asset_id,quote_asset_id,quote_currency,mapping_version,amount_decimal,schedule_type,time_zone,anchor_local,status,plan_version,created_at,updated_at) VALUES ('p2','alice','ETH/USD','eip155:8453/native','iso4217:USD','USD','catalog-1','-1','weekly','UTC','2026-09-23T09:00','active',1,'x','x');`);
    expect(badAmount.status).not.toBe(0);
    const mixed = sqlite(`${setup}\nINSERT INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,plan_id,plan_version,due_at,alert_id,threshold_version,crossing_observation_id,created_at) VALUES ('o1','alice','plan','p1',1,'2026-09-30T08:00:00Z','a1',1,'obs-1','x');`);
    expect(mixed.status).not.toBe(0);
  });
  it("requires non-null occurrence versions so unique identities cannot be bypassed", () => {
    const plan = sqlite(`${setup}\nINSERT INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,plan_id,due_at,created_at) VALUES ('o1','alice','plan','p1','2026-09-30T08:00:00Z','2026-09-23T00:00:00Z');`);
    expect(plan.status).not.toBe(0);
    const alert = sqlite(`${setup}\nINSERT INTO swap_reminder_occurrences (occurrence_id,subject_reference,kind,alert_id,crossing_observation_id,observed_price_decimal,source_observed_at,created_at) VALUES ('o1','alice','alert','a1','obs-1','3001','2026-09-23T10:00:00Z','2026-09-23T10:01:00Z');`);
    expect(alert.status).not.toBe(0);
  });
  it.each(["1.", "01", "0.0000000000000000001", `${"9".repeat(61)}`])("rejects noncanonical decimal %s in alert and plan rows", (value) => {
    const alert = sqlite(`${setup}\nUPDATE price_alerts SET threshold_decimal = '${value}' WHERE alert_id = 'a1';`);
    expect(alert.status).not.toBe(0);
    const plan = sqlite(`${setup}\nUPDATE swap_reminder_plans SET amount_decimal = '${value}' WHERE plan_id = 'p1';`);
    expect(plan.status).not.toBe(0);
  });
});
