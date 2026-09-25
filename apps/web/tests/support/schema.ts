import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const migrationsDirectory = resolve(process.cwd(), "../../infra/d1/migrations");

/** Every D1 migration, in apply order, as one SQL script. */
export function schemaSql(): string {
  return readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort()
    .map((name) => readFileSync(resolve(migrationsDirectory, name), "utf8")).join("\n");
}

/** An in-memory database with the full D1 schema applied and foreign keys enforced. */
export function schemaDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(schemaSql());
  return db;
}

/** A subject, wallet, and reviewed intent `intent-1` that child evidence rows can reference. */
export const intentFixtureSql = `
INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
  VALUES ('subject-1', 'subject-1', '2026-09-21T00:00:00Z', '2026-09-21T00:00:00Z');
INSERT INTO wallet_references (wallet_reference, subject_reference, provider, address, chain_family, control_model, observed_at)
  VALUES ('wallet-1', 'subject-1', 'privy', '0x1111111111111111111111111111111111111111', 'evm', 'customer', '2026-09-21T00:00:00Z');
INSERT INTO transaction_intents (intent_id, subject_reference, wallet_reference, intent_type, chain_id, request_json,
  policy_result_json, disclosure_version, status, created_at, updated_at, expires_at)
  VALUES ('intent-1', 'subject-1', 'wallet-1', 'transfer', 8453, '{}', '{}', 'v1', 'reviewed',
    '2026-09-21T00:00:00Z', '2026-09-21T00:00:00Z', '2026-09-22T00:00:00Z');`;

/** Run SQL through the sqlite3 CLI against the full schema plus `intentFixtureSql`. */
export function sqliteWithIntent(sql: string) {
  return spawnSync("sqlite3", [":memory:"], {
    input: `PRAGMA foreign_keys = ON;\n${schemaSql()}\n${intentFixtureSql}\n${sql}`, encoding: "utf8"
  });
}
