import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = resolve(process.cwd(), "../../infra/d1/migrations");
const timestamp = "2026-09-23T00:00:00.000Z";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(resolve(migrations, file), "utf8"));
  }
  db.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
      VALUES ('subject-a', 'subject-a', '${timestamp}', '${timestamp}');
    INSERT INTO wallet_references (wallet_reference, subject_reference, provider, address, chain_family, control_model, observed_at)
      VALUES ('wallet-a', 'subject-a', 'privy', '0x1111111111111111111111111111111111111111', 'evm', 'customer', '${timestamp}');
    INSERT INTO transaction_intents (intent_id, subject_reference, wallet_reference, intent_type, chain_id, request_json,
      policy_result_json, disclosure_version, status, created_at, updated_at, expires_at)
      VALUES ('intent-1', 'subject-a', 'wallet-a', 'transfer', 8453, '{}', '{}', 'v1', 'reviewed',
        '${timestamp}', '${timestamp}', '2026-09-23T00:05:00.000Z');`);
  return db;
}

const prepared = `INSERT INTO intent_prepared_calls
  (intent_id, step_index, subject_reference, wallet_address, chain_id, target_address, native_value,
   calldata_hash, call_fingerprint, semantic_action, source_reference, expires_at, expected_effect_json,
   verification_state, created_at, submission_phase)
  VALUES ('intent-1', 0, 'subject-a', '0x1111111111111111111111111111111111111111', 8453,
    '0x2222222222222222222222222222222222222222', '1', 'sha256:data', 'sha256:call',
    'native_transfer', 'review-1', '2026-09-23T00:05:00.000Z',
    '{"type":"native_transfer","recipient":"0x2222222222222222222222222222222222222222","amountRaw":"1"}',
    'prepared', '${timestamp}', 'awaiting_step_up')`;

const candidate = `INSERT INTO intent_observation_candidates
  (report_id, subject_reference, intent_id, step_index, chain_id, transaction_hash, prepared_fingerprint,
   prepared_phase, control_reasons_json, verification_state, reported_at)
  VALUES ('report-1', 'subject-a', 'intent-1', 0, 8453, '0xABC', 'sha256:call',
    'awaiting_step_up', '["expired_review"]', 'unindexed', '${timestamp}')`;

describe("late observation migration", () => {
  it("retains a candidate and its verification history", () => {
    const db = database();
    try {
      db.exec(prepared);
      db.exec(candidate);
      db.exec(`UPDATE intent_observation_candidates SET verification_state = 'identity_matched',
        canonical_block_hash = '0xblock', last_checked_at = '${timestamp}' WHERE report_id = 'report-1'`);
      db.exec(`INSERT INTO intent_observation_checks
        (check_id, report_id, verification_state, reason, canonical_block_hash, evidence_json, checked_at)
        VALUES ('check-1', 'report-1', 'identity_matched', NULL, '0xblock', '{"receiptStatus":"success","confirmations":3}', '${timestamp}')`);
      expect(db.prepare("SELECT verification_state, canonical_block_hash FROM intent_observation_candidates WHERE report_id = 'report-1'").get())
        .toMatchObject({ verification_state: "identity_matched", canonical_block_hash: "0xblock" });
      expect(db.prepare("SELECT verification_state FROM intent_observation_checks WHERE report_id = 'report-1'").get())
        .toMatchObject({ verification_state: "identity_matched" });
      expect(db.prepare("SELECT json_extract(evidence_json, '$.confirmations') AS confirmations FROM intent_observation_checks WHERE report_id = 'report-1'").get())
        .toMatchObject({ confirmations: 3 });
    } finally { db.close(); }
  });

  it("rejects the same candidate hash with different case", () => {
    const db = database();
    try {
      db.exec(prepared);
      db.exec(candidate);
      expect(() => db.exec(candidate.replaceAll("report-1", "report-2").replace("0xABC", "0xabc"))).toThrow();
    } finally { db.close(); }
  });

  it("binds candidates to the exact reviewed direct-transfer call", () => {
    const db = database();
    try {
      db.exec(prepared);
      for (const invalid of [
        candidate.replace("'subject-a', 'intent-1'", "'subject-b', 'intent-1'"),
        candidate.replace("'sha256:call'", "'sha256:other'"),
        candidate.replace("'awaiting_step_up'", "'legacy'"),
        candidate.replace("'intent-1', 0,", "'intent-1', 1,")
      ]) expect(() => db.exec(invalid), invalid).toThrow();
    } finally { db.close(); }
  });

  it("rejects a candidate attached to a non-transfer parent intent", () => {
    const db = database();
    try {
      db.exec(prepared);
      db.exec("UPDATE transaction_intents SET intent_type = 'swap' WHERE intent_id = 'intent-1'");
      expect(() => db.exec(candidate)).toThrow();
    } finally { db.close(); }
  });

  it("prevents ordinary calls and candidates from claiming each other's hash", () => {
    const db = database();
    try {
      db.exec(prepared);
      db.exec(candidate);
      db.exec(prepared.replace("('intent-1', 0,", "('intent-1', 1,").replace("'awaiting_step_up')", "'legacy')"));
      expect(() => db.exec("UPDATE intent_prepared_calls SET reported_hash = '0xabc' WHERE intent_id = 'intent-1' AND step_index = 1"))
        .toThrow(/observation candidate/);
      db.exec("UPDATE intent_prepared_calls SET reported_hash = '0xDEF' WHERE intent_id = 'intent-1' AND step_index = 1");
      expect(() => db.exec(candidate.replaceAll("report-1", "report-2").replace("0xABC", "0xdef")))
        .toThrow(/prepared call/);
      const claimedAtInsert = prepared.replace("('intent-1', 0,", "('intent-1', 2,")
        .replace("verification_state, created_at, submission_phase)", "reported_hash, verification_state, created_at, submission_phase)")
        .replace(`'prepared', '${timestamp}', 'awaiting_step_up')`, `'0xabc', 'pending', '${timestamp}', 'legacy')`);
      expect(() => db.exec(claimedAtInsert)).toThrow(/observation candidate/);
    } finally { db.close(); }
  });

  it("protects candidate identity and all retained evidence from changes or deletion", () => {
    const db = database();
    try {
      db.exec(prepared);
      db.exec(candidate);
      db.exec(`INSERT INTO intent_observation_checks
        (check_id, report_id, verification_state, reason, evidence_json, checked_at)
        VALUES ('check-1', 'report-1', 'unindexed', NULL, '{}', '${timestamp}')`);
      for (const sql of [
        "UPDATE intent_observation_candidates SET transaction_hash = '0xchanged' WHERE report_id = 'report-1'",
        "UPDATE intent_observation_candidates SET prepared_fingerprint = 'changed' WHERE report_id = 'report-1'",
        "DELETE FROM intent_observation_candidates WHERE report_id = 'report-1'",
        "UPDATE intent_observation_checks SET reason = 'changed' WHERE check_id = 'check-1'",
        "DELETE FROM intent_observation_checks WHERE check_id = 'check-1'"
      ]) expect(() => db.exec(sql), sql).toThrow();
    } finally { db.close(); }
  });

  it("rejects invalid verification states and invalid reason JSON", () => {
    const db = database();
    try {
      db.exec(prepared);
      expect(() => db.exec(candidate.replace("'unindexed'", "'confirmed'"))).toThrow();
      expect(() => db.exec(candidate.replace("'[\"expired_review\"]'", "'not json'"))).toThrow();
      db.exec(candidate);
      expect(() => db.exec(`INSERT INTO intent_observation_checks
        (check_id, report_id, verification_state, evidence_json, checked_at)
        VALUES ('check-1', 'report-1', 'confirmed', '{}', '${timestamp}')`)).toThrow();
    } finally { db.close(); }
  });
});
