import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = resolve(process.cwd(), "../../infra/d1/migrations");
const sourceHash = `0x${"a".repeat(64)}`;
const secondSourceHash = `0x${"e".repeat(64)}`;
const destinationHash = `0x${"b".repeat(64)}`;
const fingerprint = `0x${"c".repeat(64)}`;

function database(withPreparedCall = true) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort())
    db.exec(readFileSync(resolve(migrations, file), "utf8"));
  db.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
      VALUES ('alice', 'alice', '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z');
    INSERT INTO wallet_references (wallet_reference, subject_reference, provider, address, chain_family, control_model, observed_at)
      VALUES ('wallet-a', 'alice', 'privy', '0x1111111111111111111111111111111111111111', 'evm', 'customer', '2026-09-23T00:00:00Z');
    INSERT INTO transaction_intents (intent_id, subject_reference, wallet_reference, intent_type, chain_id,
      request_json, policy_result_json, disclosure_version, status, transaction_hash, created_at, updated_at, expires_at,
      route_reference)
      VALUES ('intent-a', 'alice', 'wallet-a', 'bridge', 8453, '{}', '{}', 'v1', 'submitted', '${sourceHash}',
        '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z', '2026-09-23T00:10:00Z', 'swap-plan:plan-a');
    INSERT INTO swap_quote_plans (plan_id, subject_reference, wallet_address, source_asset_id, destination_asset_id,
      source_chain_id, destination_chain_id, from_amount_raw, recipient, slippage_bps, to_amount_min_raw,
      quote_id, step_id, tool_id, approval_spender, route_steps_json, source_call_json, route_policy_version,
      catalog_version, observed_at, expires_at, fingerprint, intent_id)
      VALUES ('plan-a', 'alice', '0x1111111111111111111111111111111111111111', '8453:usdc', '42161:usdc',
        8453, 42161, '1000000', '0x1111111111111111111111111111111111111111', 50, '990000',
        'quote-a', 'quote-a', 'across', NULL, '[]', '{}', 'policy-v1', 'catalog-v1',
        '2026-09-23T00:00:00Z', '2026-09-23T00:01:00Z', '${fingerprint}', 'intent-a');`);
  if (withPreparedCall) {
    // Bridge release is intentionally not live yet. Seed a confirmed source
    // proof for this migration's retention/identity tests, then restore the
    // production release trigger before exercising destination inserts.
    db.exec("DROP TRIGGER intent_prepared_calls_step_up_insert");
    db.exec(`INSERT INTO intent_prepared_calls (intent_id, step_index, subject_reference, wallet_address,
      chain_id, target_address, native_value, calldata_hash, call_fingerprint, semantic_action,
      source_reference, expires_at, expected_effect_json, reported_hash, verification_state,
      created_at, submission_phase)
      VALUES ('intent-a', 0, 'alice', '0x1111111111111111111111111111111111111111', 8453,
        '0x2222222222222222222222222222222222222222', '0', 'sha256:data', 'call-fingerprint-a',
        'bridge', 'swap-plan:plan-a', '2026-09-23T00:10:00Z', '{}', '${sourceHash}',
        'confirmed', '2026-09-23T00:00:00Z', 'released')`);
    db.exec(readFileSync(resolve(migrations, "0030_governed_swap_preparation.sql"), "utf8")
      .replace("DROP TRIGGER intent_prepared_calls_step_up_insert;", ""));
  }
  return db;
}

function record(db: DatabaseSync, intent = "intent-a", plan = "plan-a",
  destination = destinationHash, source = sourceHash) {
  db.prepare(`INSERT INTO swap_destination_observations (intent_id, subject_reference, plan_id, plan_fingerprint,
    source_hash, source_call_fingerprint, destination_chain_id, destination_hash, provider_status,
    provider_substatus, verification_state, checked_at, created_at)
    VALUES (?, 'alice', ?, ?, ?, 'call-fingerprint-a', 42161, ?, 'DONE', 'COMPLETED',
      'pending', '2026-09-23T00:05:00Z', '2026-09-23T00:05:00Z')`)
    .run(intent, plan, fingerprint, source, destination);
}

describe("durable swap destination evidence", () => {
  it("binds one observation to its reviewed bridge plan and permits only evidence-state updates", () => {
    const db = database();
    try {
      record(db);
      db.exec(`UPDATE swap_destination_observations SET verification_state = 'complete',
        observed_block_hash = '0x${"d".repeat(64)}', checked_at = '2026-09-23T00:06:00Z'
        WHERE intent_id = 'intent-a'`);
      expect(db.prepare("SELECT verification_state, destination_chain_id FROM swap_destination_observations").get())
        .toMatchObject({ verification_state: "complete", destination_chain_id: 42161 });
      expect(() => db.exec("UPDATE swap_destination_observations SET plan_fingerprint = 'other' WHERE intent_id = 'intent-a'")).toThrow();
      expect(() => db.exec("UPDATE swap_destination_observations SET source_hash = 'other' WHERE intent_id = 'intent-a'")).toThrow();
      expect(() => db.exec(`UPDATE swap_destination_observations SET destination_hash = '0x${"e".repeat(64)}' WHERE intent_id = 'intent-a'`)).toThrow();
    } finally { db.close(); }
  });

  it("rejects a plan/intent mismatch and prevents reusing a destination hash", () => {
    const db = database();
    try {
      expect(() => record(db, "unknown")).toThrow();
      record(db);
      db.exec(`INSERT INTO transaction_intents (intent_id, subject_reference, wallet_reference, intent_type, chain_id,
        request_json, policy_result_json, disclosure_version, status, transaction_hash, created_at, updated_at, expires_at,
        route_reference)
        VALUES ('intent-b', 'alice', 'wallet-a', 'bridge', 8453, '{}', '{}', 'v1', 'submitted', '${secondSourceHash}',
          '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z', '2026-09-23T00:10:00Z', 'swap-plan:plan-b')`);
      expect(() => record(db, "intent-b")).toThrow();
      db.exec(`INSERT INTO swap_quote_plans (plan_id, subject_reference, wallet_address, source_asset_id,
        destination_asset_id, source_chain_id, destination_chain_id, from_amount_raw, recipient, slippage_bps,
        to_amount_min_raw, quote_id, step_id, tool_id, approval_spender, route_steps_json, source_call_json,
        route_policy_version, catalog_version, observed_at, expires_at, fingerprint, intent_id)
        SELECT 'plan-b', subject_reference, wallet_address, source_asset_id, destination_asset_id,
          source_chain_id, destination_chain_id, from_amount_raw, recipient, slippage_bps,
          to_amount_min_raw, 'quote-b', 'quote-b', tool_id, approval_spender, route_steps_json, source_call_json,
          route_policy_version, catalog_version, observed_at, expires_at, fingerprint, 'intent-b'
        FROM swap_quote_plans WHERE plan_id = 'plan-a'`);
      db.exec("DROP TRIGGER intent_prepared_calls_step_up_insert");
      db.exec(`INSERT INTO intent_prepared_calls (intent_id, step_index, subject_reference, wallet_address,
        chain_id, target_address, native_value, calldata_hash, call_fingerprint, semantic_action,
        source_reference, expires_at, expected_effect_json, reported_hash, verification_state,
        created_at, submission_phase)
        SELECT 'intent-b', step_index, subject_reference, wallet_address, chain_id, target_address,
          native_value, calldata_hash, call_fingerprint, semantic_action, 'swap-plan:plan-b',
          expires_at, expected_effect_json, '${secondSourceHash}', verification_state,
          created_at, submission_phase FROM intent_prepared_calls WHERE intent_id = 'intent-a'`);
      db.exec(readFileSync(resolve(migrations, "0030_governed_swap_preparation.sql"), "utf8")
        .replace("DROP TRIGGER intent_prepared_calls_step_up_insert;", ""));
      expect(() => record(db, "intent-b", "plan-b", destinationHash, secondSourceHash)).toThrow(/UNIQUE/);
    } finally { db.close(); }
  });

  it("rejects malformed destination transaction hashes before they become evidence", () => {
    const db = database();
    try { expect(() => record(db, "intent-a", "plan-a", "0xnot-a-hash")).toThrow(); }
    finally { db.close(); }
  });

  it("requires a matching confirmed prepared source call", () => {
    const db = database(false);
    try { expect(() => record(db)).toThrow(); }
    finally { db.close(); }
  });

  it("keeps provider status separate from substatus and forbids empty completion evidence", () => {
    const db = database();
    try {
      db.exec(`INSERT INTO swap_destination_observations (intent_id, subject_reference, plan_id,
        plan_fingerprint, source_hash, source_call_fingerprint, destination_chain_id,
        provider_status, verification_state, checked_at, created_at)
        VALUES ('intent-a', 'alice', 'plan-a', '${fingerprint}', '${sourceHash}',
          'call-fingerprint-a', 42161, 'NOT_FOUND', 'pending', '2026-09-23T00:05:00Z',
          '2026-09-23T00:05:00Z')`);
      expect(() => db.exec(`UPDATE swap_destination_observations SET verification_state = 'complete',
        provider_status = 'DONE', provider_substatus = 'COMPLETED' WHERE intent_id = 'intent-a'`)).toThrow();
      expect(() => db.exec(`UPDATE swap_destination_observations SET provider_status = 'PARTIAL'
        WHERE intent_id = 'intent-a'`)).toThrow();
    } finally { db.close(); }
  });
});
