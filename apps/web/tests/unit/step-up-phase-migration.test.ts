import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = resolve(process.cwd(), "../../infra/d1/migrations");

function database(withNewMigration = true) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql") && (withNewMigration || (!name.startsWith("0026_") && !name.startsWith("0030_") && !name.startsWith("0034_")))).sort())
    db.exec(readFileSync(resolve(migrations, file), "utf8"));
  db.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
      VALUES ('subject-a', 'subject-a', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');
    INSERT INTO wallet_references (wallet_reference, subject_reference, provider, address, chain_family, control_model, observed_at)
      VALUES ('wallet-a', 'subject-a', 'privy', '0x1111111111111111111111111111111111111111', 'evm', 'customer', '2026-09-23T00:00:00.000Z');
    INSERT INTO transaction_intents (intent_id, subject_reference, wallet_reference, intent_type, chain_id, request_json,
      policy_result_json, disclosure_version, status, created_at, updated_at, expires_at)
      VALUES ('intent-1', 'subject-a', 'wallet-a', 'transfer', 8453, '{}', '{}', 'v1', 'reviewed',
        '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z', '2026-09-23T00:05:00.000Z');`);
  return db;
}

const call = `INSERT INTO intent_prepared_calls
  (intent_id, step_index, subject_reference, wallet_address, chain_id, target_address, native_value,
   calldata_hash, call_fingerprint, semantic_action, source_reference, expires_at, expected_effect_json,
   verification_state, created_at, submission_phase)
  VALUES ('intent-1', 0, 'subject-a', '0x1111111111111111111111111111111111111111', 8453,
    '0x2222222222222222222222222222222222222222', '1', 'sha256:data', 'sha256:call',
    'native_transfer', 'review-1', '2026-09-23T00:05:00.000Z',
    '{"type":"native_transfer","recipient":"0x2222222222222222222222222222222222222222","amountRaw":"1"}',
    'prepared', '2026-09-23T00:00:00.000Z', 'awaiting_step_up')`;

describe("step-up submission phase migration", () => {
  it("preserves legacy prepared rows and holds a new high-value plan without a hash", () => {
    const db = database(false);
    try {
      db.exec(call.replace(", submission_phase)", ")").replace(", 'awaiting_step_up')", ")").replace("('intent-1', 0,", "('intent-1', 1,"));
      db.exec(readFileSync(resolve(migrations, "0026_step_up_submission_phase.sql"), "utf8"));
      expect(db.prepare("SELECT submission_phase FROM intent_prepared_calls").get()).toMatchObject({ submission_phase: null });
      db.exec(call);
      expect(db.prepare("SELECT submission_phase, reported_hash, verification_state FROM intent_prepared_calls WHERE step_index = 0").get())
        .toMatchObject({ submission_phase: "awaiting_step_up", reported_hash: null, verification_state: "prepared" });
    } finally { db.close(); }
  });

  it("rejects hash, state, or phase changes to an awaiting plan", () => {
    const db = database();
    try {
      db.exec(call);
      for (const sql of [
        "UPDATE intent_prepared_calls SET reported_hash = '0xabc' WHERE intent_id = 'intent-1'",
        "UPDATE intent_prepared_calls SET verification_state = 'pending' WHERE intent_id = 'intent-1'",
        "UPDATE intent_prepared_calls SET submission_phase = 'released' WHERE intent_id = 'intent-1'"
      ]) expect(() => db.exec(sql)).toThrow();
    } finally { db.close(); }
  });

  it("rejects a new call whose writer omits its phase, but permits an explicit legacy call", () => {
    const db = database();
    const omitted = call.replace(", submission_phase)", ")").replace(", 'awaiting_step_up')", ")");
    try {
      expect(() => db.exec(omitted)).toThrow();
      expect(db.prepare("SELECT COUNT(*) AS count FROM intent_prepared_calls").get()).toMatchObject({ count: 0 });
      db.exec(call.replace("'awaiting_step_up')", "'legacy')"));
      expect(db.prepare("SELECT submission_phase FROM intent_prepared_calls").get()).toMatchObject({ submission_phase: "legacy" });
    } finally { db.close(); }
  });

  it.each([
    ["pending state", call.replace("'prepared', '2026-09-23T00:00:00.000Z'", "'pending', '2026-09-23T00:00:00.000Z'")],
    ["other chain", call.replace(", 8453,", ", 1,")],
    ["approval", call.replace("'native_transfer',", "'erc20_approval',")],
    ["later step", call.replace("('intent-1', 0,", "('intent-1', 1,")],
    ["premature release", call.replace("'awaiting_step_up')", "'released')")]
  ])("rejects an awaiting plan with %s", (_name, invalidCall) => {
    const db = database();
    try { expect(() => db.exec(invalidCall)).toThrow(); }
    finally { db.close(); }
  });
});
