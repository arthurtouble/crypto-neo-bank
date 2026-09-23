import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi } from "viem";

const migrationDirectory = resolve(process.cwd(), "../../infra/d1/migrations");
const at = "2026-09-23T00:00:00.000Z";
const expiry = "2026-09-23T00:00:45.000Z";
const approvalExpiry = expiry;
const wallet = "0x1111111111111111111111111111111111111111";
const router = "0x2626664c2603336e57b271c5c0b26f421741e481";
const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort())
    db.exec(readFileSync(resolve(migrationDirectory, file), "utf8"));
  db.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
      VALUES ('subject-a', 'subject-a', '${at}', '${at}');
    INSERT INTO wallet_references (wallet_reference, subject_reference, provider, address, chain_family, control_model, observed_at)
      VALUES ('wallet-a', 'subject-a', 'privy', '${wallet}', 'evm', 'customer', '${at}');
    INSERT INTO transaction_intents (intent_id, subject_reference, wallet_reference, intent_type, chain_id, request_json,
      policy_result_json, disclosure_version, status, created_at, updated_at, expires_at, route_reference)
      VALUES ('intent-a', 'subject-a', 'wallet-a', 'swap', 8453, '{}', '{"permitted":true}', 'v1', 'reviewed', '${at}', '${at}', '${expiry}', 'swap-plan:plan-a');
    INSERT INTO security_profiles (subject_reference, updated_at) VALUES ('subject-a', '${at}');
    INSERT INTO beta_access (subject_reference, cohort, country_code, status, terms_version, terms_accepted_at, activated_at, updated_at)
      VALUES ('subject-a', 'test', 'PT', 'active', 'v1', '${at}', '${at}', '${at}');
    UPDATE feature_flags SET enabled = 1 WHERE flag_key = 'swaps';
    INSERT INTO swap_quote_plans
      (plan_id, subject_reference, wallet_address, source_asset_id, destination_asset_id, source_chain_id, destination_chain_id,
       from_amount_raw, recipient, slippage_bps, to_amount_min_raw, quote_id, step_id, tool_id, approval_spender,
       source_call_json, route_policy_version, catalog_version, observed_at, expires_at, fingerprint, intent_id)
      VALUES ('plan-a', 'subject-a', '${wallet}', '8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
       '8453:0x4200000000000000000000000000000000000006', 8453, 8453, '1000000', '${wallet}', 50,
       '100', 'quote-a', 'quote-a', 'uniswap_v3_direct', '${router}',
       '{"chainId":8453,"from":"${wallet}","to":"${router}","value":"0","data":"0x1234"}',
       'policy', 'catalog', '${at}', '${expiry}', 'hash', 'intent-a');`);
  return db;
}

function insert(db: DatabaseSync, amount = "1000000", subject = "subject-a") {
  const call = JSON.stringify({ chainId: 8453, from: wallet, to: token, value: "0",
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, BigInt(amount)] }) });
  db.prepare(`INSERT INTO swap_approval_requests
    (approval_id, subject_reference, wallet_address, intent_id, plan_id, token_address,
     spender_address, amount_raw, call_json, call_fingerprint, status, expires_at, created_at, updated_at)
    VALUES ('approval-a', ?, ?, 'intent-a', 'plan-a', ?,
      ?, ?, ?, 'hash', 'prepared', ?, ?, ?)`).run(subject, wallet, token, router, amount, call, approvalExpiry, at, at);
}

describe("separate swap approval migration", () => {
  it("accepts an exact approval and a zero reset for a reviewed active plan", () => {
    for (const amount of ["1000000", "0"]) {
      const db = database();
      try { insert(db, amount); expect(db.prepare("SELECT amount_raw FROM swap_approval_requests").get())
        .toMatchObject({ amount_raw: amount }); }
      finally { db.close(); }
    }
  });

  it("rejects a different customer or excess amount, and keeps call identity immutable", () => {
    const other = database();
    try { expect(() => insert(other, "1000000", "subject-b")).toThrow(); }
    finally { other.close(); }
    const excess = database();
    try { expect(() => insert(excess, "1000001")).toThrow(); }
    finally { excess.close(); }
    const changed = database();
    try {
      insert(changed);
      expect(() => changed.exec("UPDATE swap_approval_requests SET call_json = '{\"data\":\"changed\"}'")).toThrow();
      changed.exec(`UPDATE swap_approval_requests SET transaction_hash = '0x${"a".repeat(64)}', status = 'submitted' WHERE approval_id = 'approval-a'`);
      expect(() => changed.exec(`UPDATE swap_approval_requests SET transaction_hash = '0x${"b".repeat(64)}' WHERE approval_id = 'approval-a'`)).toThrow();
    } finally { changed.close(); }
  });
});
