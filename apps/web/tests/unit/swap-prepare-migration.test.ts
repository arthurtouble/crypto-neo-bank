import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = resolve(process.cwd(), "../../infra/d1/migrations");

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort())
    db.exec(readFileSync(resolve(migrations, file), "utf8"));
  db.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
      VALUES ('subject-a', 'subject-a', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');
    INSERT INTO wallet_references (wallet_reference, subject_reference, provider, address, chain_family, control_model, observed_at)
      VALUES ('wallet:0x1111111111111111111111111111111111111111', 'subject-a', 'privy', '0x1111111111111111111111111111111111111111', 'evm', 'customer', '2026-09-23T00:00:00.000Z');
    INSERT INTO transaction_intents (intent_id, subject_reference, wallet_reference, intent_type, chain_id, request_json,
      policy_result_json, disclosure_version, status, created_at, updated_at, expires_at)
      VALUES ('intent-1', 'subject-a', 'wallet:0x1111111111111111111111111111111111111111', 'swap', 8453, '{}', '{}', 'v1', 'reviewed',
        '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z', '2026-09-23T00:05:00.000Z');`);
  return db;
}

const call = `INSERT INTO intent_prepared_calls
  (intent_id, step_index, subject_reference, wallet_address, chain_id, target_address, native_value,
   calldata_hash, call_fingerprint, semantic_action, source_reference, expires_at, expected_effect_json,
   verification_state, created_at, submission_phase)
  VALUES ('intent-1', 0, 'subject-a', '0x1111111111111111111111111111111111111111', 8453,
    '0x2222222222222222222222222222222222222222', '0', 'sha256:data', 'sha256:call',
    'swap', 'swap-plan:plan-1', '2026-09-23T00:05:00.000Z', '{"type":"swap"}',
    'prepared', '2026-09-23T00:00:00.000Z', 'released')`;

describe("governed Swap prepared-call migration", () => {
  it.each([{ chainId: 42161, destination: "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
    { chainId: 1, destination: "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" }])(
    "permits only a bound, reviewed Base-to-$chainId LI.FI bridge source", ({ chainId, destination }) => {
    const db = database();
    try {
      db.exec(`UPDATE transaction_intents SET intent_type = 'bridge', route_reference = 'swap-plan:plan-1'
        WHERE intent_id = 'intent-1';
        INSERT INTO swap_quote_plans (plan_id, subject_reference, wallet_address, source_asset_id,
          destination_asset_id, source_chain_id, destination_chain_id, from_amount_raw, recipient,
          slippage_bps, to_amount_min_raw, quote_id, step_id, tool_id, approval_spender,
          source_call_json, route_policy_version, catalog_version, observed_at, expires_at,
          fingerprint, intent_id)
        VALUES ('plan-1', 'subject-a', '0x1111111111111111111111111111111111111111',
          '8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          '${destination}', 8453, ${chainId}, '1000000',
          '0x1111111111111111111111111111111111111111', 50, '900000', 'quote-1', 'quote-1',
          'across', '0x2222222222222222222222222222222222222222', '{}', 'v1', 'v1',
          '2026-09-23T00:00:00.000Z', '2026-09-23T00:05:00.000Z', 'fingerprint', 'intent-1');`);
      db.exec(call.replace("'swap', 'swap-plan:plan-1'", "'bridge', 'swap-plan:plan-1'")
        .replace("'{\"type\":\"swap\"}'", `'${JSON.stringify({ type: "bridge", sourceAmountRaw: "1000000",
          minimumOutputRaw: "900000", destinationChainId: chainId, destinationAssetId: destination })}'`));
      expect(db.prepare("SELECT semantic_action FROM intent_prepared_calls").get())
        .toMatchObject({ semantic_action: "bridge" });
      db.exec(`INSERT INTO intent_observation_candidates
        (report_id, subject_reference, intent_id, step_index, chain_id, transaction_hash,
          prepared_fingerprint, prepared_phase, control_reasons_json, reported_at)
        VALUES ('late-bridge', 'subject-a', 'intent-1', 0, 8453, '0xabc', 'sha256:call',
          'released', '["review_expired"]', '2026-09-23T00:06:00.000Z')`);
      expect(db.prepare("SELECT verification_state FROM intent_observation_candidates WHERE report_id = 'late-bridge'").get())
        .toMatchObject({ verification_state: "unindexed" });
      for (const [id, fingerprint, phase] of [
        ["wrong-fingerprint", "sha256:wrong", "released"],
        ["wrong-phase", "sha256:call", "awaiting_step_up"]
      ]) expect(() => db.exec(`INSERT INTO intent_observation_candidates
        (report_id, subject_reference, intent_id, step_index, chain_id, transaction_hash,
          prepared_fingerprint, prepared_phase, control_reasons_json, reported_at)
        VALUES ('${id}', 'subject-a', 'intent-1', 0, 8453, '0x${id === "wrong-phase" ? "def" : "fed"}',
          '${fingerprint}', '${phase}', '["review_expired"]', '2026-09-23T00:06:00.000Z')`)).toThrow();
    } finally { db.close(); }
  });

  it("permits only an explicit released Base Swap first step", () => {
    const db = database();
    try {
      db.exec(call);
      expect(db.prepare("SELECT submission_phase, semantic_action FROM intent_prepared_calls").get())
        .toMatchObject({ submission_phase: "released", semantic_action: "swap" });
    } finally { db.close(); }
  });

  it.each([
    ["direct transfer release", call.replace("'swap', 'swap-plan:plan-1'", "'erc20_transfer', 'swap-plan:plan-1'")],
    ["other chain", call.replace(", 8453,", ", 1,")],
    ["later step", call.replace("('intent-1', 0,", "('intent-1', 1,")],
    ["pre-claimed hash", call.replace("verification_state, created_at, submission_phase)", "verification_state, created_at, submission_phase, reported_hash)")
      .replace("'released')", "'released', '0xabc')")]
  ])("rejects %s", (_name, invalid) => {
    const db = database();
    try { expect(() => db.exec(invalid)).toThrow(); }
    finally { db.close(); }
  });

  it("cannot label a direct-transfer intent as a released Swap", () => {
    const db = database();
    try {
      db.exec("UPDATE transaction_intents SET intent_type = 'transfer' WHERE intent_id = 'intent-1'");
      expect(() => db.exec(call)).toThrow();
    } finally { db.close(); }
  });
});
