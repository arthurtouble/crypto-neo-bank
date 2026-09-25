import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { schemaSql } from "../support/schema";

const intent = (id: string, subject: string, wallet: string, status = "reviewed") => `INSERT INTO transaction_intents
  (intent_id, subject_reference, wallet_reference, intent_type, chain_id, request_json, policy_result_json,
   disclosure_version, status, created_at, updated_at, expires_at)
  VALUES ('${id}', '${subject}', '${wallet}', 'bridge', 8453, '{}', '{}', 'v1', '${status}',
    '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z', '2026-09-23T00:10:00Z');`;
const wallet = (id: string, subject: string, address: string) => `INSERT INTO wallet_references
  (wallet_reference, subject_reference, provider, address, chain_family, control_model, observed_at)
  VALUES ('${id}', '${subject}', 'privy', '${address}', 'evm', 'customer', '2026-09-23T00:00:00Z');`;
const subject = (id: string) => `INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
  VALUES ('${id}', '${id}', '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z');`;
const fixture = [
  subject("subject-a"), subject("subject-b"),
  wallet("wallet-a", "subject-a", "0x1111111111111111111111111111111111111111"),
  wallet("wallet-a2", "subject-a", "0x3333333333333333333333333333333333333333"),
  wallet("wallet-b", "subject-b", "0x2222222222222222222222222222222222222222"),
  intent("intent-a", "subject-a", "wallet-a"), intent("intent-a2", "subject-a", "wallet-a2"),
  intent("intent-b", "subject-b", "wallet-b"), intent("submitted-intent", "subject-a", "wallet-a", "submitted")
].join("\n");
const row = `INSERT INTO swap_quote_plans
  (plan_id, subject_reference, wallet_address, source_asset_id, destination_asset_id, source_chain_id, destination_chain_id,
   from_amount_raw, recipient, slippage_bps, to_amount_min_raw, quote_id, step_id, tool_id, approval_spender,
   source_call_json, route_policy_version, catalog_version, observed_at, expires_at, fingerprint)
  VALUES ('plan-1', 'subject-a', '0x1111111111111111111111111111111111111111', '8453:native', '1:native', 8453, 1,
    '100', '0x1111111111111111111111111111111111111111', 50, '90', 'quote-1', 'quote-1', 'across', NULL,
    '{"chainId":8453,"from":"0x1111111111111111111111111111111111111111","to":"0x3333333333333333333333333333333333333333","value":"100","data":"0x1234"}',
    'route-v1', 'catalog-v1', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:45.000Z', '0xabc');`;

function sqlite(sql: string) {
  return spawnSync("sqlite3", [":memory:"], { input: `PRAGMA foreign_keys = ON;\n${schemaSql()}\n${fixture}\n${sql}`, encoding: "utf8" });
}
const hardened = (sql: string) => sqlite(`${row}\n${sql}`);

describe("server-held Swap plans", () => {
  it("stores a subject-scoped plan", () => {
    const result = sqlite(`${row} SELECT plan_id, subject_reference, status FROM swap_quote_plans;`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("plan-1|subject-a|active");
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
