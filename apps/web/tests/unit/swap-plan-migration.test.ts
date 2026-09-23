import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const migration = () => readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0021_server_held_swap_plans.sql"), "utf8");
const hardening = () => readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0023_swap_plan_integrity.sql"), "utf8");
const parent = "PRAGMA foreign_keys = ON; CREATE TABLE transaction_intents (intent_id TEXT PRIMARY KEY); INSERT INTO transaction_intents VALUES ('submitted-intent');";
const row = `INSERT INTO swap_quote_plans
  (plan_id, subject_reference, wallet_address, source_asset_id, destination_asset_id, source_chain_id, destination_chain_id,
   from_amount_raw, recipient, slippage_bps, to_amount_min_raw, quote_id, step_id, tool_id, approval_spender,
   source_call_json, route_policy_version, catalog_version, observed_at, expires_at, fingerprint)
  VALUES ('plan-1', 'subject-a', '0x1111111111111111111111111111111111111111', '8453:native', '1:native', 8453, 1,
    '100', '0x1111111111111111111111111111111111111111', 50, '90', 'quote-1', 'quote-1', 'across', NULL,
    '{"chainId":8453,"from":"0x1111111111111111111111111111111111111111","to":"0x3333333333333333333333333333333333333333","value":"100","data":"0x1234"}',
    'route-v1', 'catalog-v1', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:45.000Z', '0xabc');`;

function sqlite(sql: string) {
  return spawnSync("sqlite3", [":memory:"], { input: `${parent}\n${migration()}\n${sql}`, encoding: "utf8" });
}

describe("server-held Swap plan migration", () => {
  it("adds a subject-scoped plan table without changing existing intents", () => {
    const result = sqlite(`${row} SELECT plan_id, subject_reference, status FROM swap_quote_plans; SELECT intent_id FROM transaction_intents;`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("plan-1|subject-a|active\nsubmitted-intent");
  });

  it("can be replayed during recovery without replacing retained plans", () => {
    const result = sqlite(`${row} ${migration()} SELECT COUNT(*) FROM swap_quote_plans;`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("1");
  });

  it("applies after every prior D1 migration", () => {
    const directory = resolve(process.cwd(), "../../infra/d1/migrations");
    const sql = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
      .map((name) => readFileSync(resolve(directory, name), "utf8")).join("\n");
    const result = spawnSync("sqlite3", [":memory:"], { input: `${sql}\nSELECT name FROM sqlite_master WHERE name = 'swap_quote_plans';`, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("swap_quote_plans");
  });

  it("keeps route identity immutable and rejects malformed call JSON", () => {
    const changed = sqlite(`${row} UPDATE swap_quote_plans SET source_call_json = '{}' WHERE plan_id = 'plan-1';`);
    expect(changed.status).not.toBe(0);
    const malformed = sqlite(row.replace("'{\"chainId\":8453", "'not-json{\"chainId\":8453"));
    expect(malformed.status).not.toBe(0);
    const changedSteps = sqlite(`${row} UPDATE swap_quote_plans SET route_steps_json = '[{"id":"other"}]' WHERE plan_id = 'plan-1';`);
    expect(changedSteps.status).not.toBe(0);
  });

  it("allows cleanup of unbound plans but protects a plan bound to a submitted intent", () => {
    const unbound = sqlite(`${row} DELETE FROM swap_quote_plans WHERE plan_id = 'plan-1'; SELECT COUNT(*) FROM swap_quote_plans;`);
    expect(unbound.status, unbound.stderr).toBe(0);
    expect(unbound.stdout.trim()).toBe("0");
    const bound = sqlite(`${row} UPDATE swap_quote_plans SET intent_id = 'submitted-intent' WHERE plan_id = 'plan-1'; DELETE FROM swap_quote_plans WHERE plan_id = 'plan-1';`);
    expect(bound.status).not.toBe(0);
  });
});

describe("server-held Swap plan integrity migration", () => {
  function hardened(sql: string) {
    const ownership = `PRAGMA foreign_keys = ON;
      CREATE TABLE wallet_references (wallet_reference TEXT PRIMARY KEY, subject_reference TEXT NOT NULL, address TEXT NOT NULL);
      INSERT INTO wallet_references VALUES ('wallet-a', 'subject-a', '0x1111111111111111111111111111111111111111');
      INSERT INTO wallet_references VALUES ('wallet-a2', 'subject-a', '0x3333333333333333333333333333333333333333');
      INSERT INTO wallet_references VALUES ('wallet-b', 'subject-b', '0x2222222222222222222222222222222222222222');
      CREATE TABLE transaction_intents (intent_id TEXT PRIMARY KEY, subject_reference TEXT NOT NULL, wallet_reference TEXT NOT NULL);
      INSERT INTO transaction_intents VALUES ('intent-a', 'subject-a', 'wallet-a');
      INSERT INTO transaction_intents VALUES ('intent-a2', 'subject-a', 'wallet-a2');
      INSERT INTO transaction_intents VALUES ('intent-b', 'subject-b', 'wallet-b');`;
    return spawnSync("sqlite3", [":memory:"], { input: `${ownership}\n${migration()}\n${row}\n${hardening()}\n${sql}`, encoding: "utf8" });
  }

  it("rejects binding another subject or wallet's intent", () => {
    const result = hardened("UPDATE swap_quote_plans SET intent_id = 'intent-b' WHERE plan_id = 'plan-1';");
    expect(result.status).not.toBe(0);
  });

  it("permits a matching intent to bind once", () => {
    const result = hardened("UPDATE swap_quote_plans SET intent_id = 'intent-a' WHERE plan_id = 'plan-1'; SELECT intent_id FROM swap_quote_plans WHERE plan_id = 'plan-1';");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("intent-a");
  });

  it("rejects binding another wallet's intent under the same subject", () => {
    const result = hardened("UPDATE swap_quote_plans SET intent_id = 'intent-a2' WHERE plan_id = 'plan-1';");
    expect(result.status).not.toBe(0);
  });

  it("keeps retained economics immutable", () => {
    const result = hardened("UPDATE swap_quote_plans SET economics_json = '{\"networkFeeUsd\":1}' WHERE plan_id = 'plan-1';");
    expect(result.status).not.toBe(0);
  });

  it("rejects resurrection of superseded and expired plans", () => {
    for (const status of ["superseded", "expired"]) {
      const result = hardened(`UPDATE swap_quote_plans SET status = '${status}' WHERE plan_id = 'plan-1'; UPDATE swap_quote_plans SET status = 'active' WHERE plan_id = 'plan-1';`);
      expect(result.status).not.toBe(0);
    }
  });
});
