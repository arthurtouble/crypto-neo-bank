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

