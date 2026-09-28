import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const state = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.database; } } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: httpErrors.AuthenticationError,
  requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "session-a" }) }));

import { GET as readPreferences, PATCH as patchPreferences } from "@/app/api/preferences/route";

let sqlite: DatabaseSync;
const migrations = resolve(process.cwd(), "../../infra/d1/migrations");
function d1(database: DatabaseSync) {
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => database.prepare(sql).get(...values as never[]) ?? null,
    all: async () => ({ results: database.prepare(sql).all(...values as never[]) }),
    run: async () => ({ meta: { changes: Number(database.prepare(sql).run(...values as never[]).changes) } })
  });
  return { prepare: (sql: string) => statement(sql), batch: async (items: Array<{ run(): Promise<unknown> }>) => {
    database.exec("BEGIN");
    try { const results = []; for (const item of items) results.push(await item.run()); database.exec("COMMIT"); return results; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  } };
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(resolve(migrations, file), "utf8"));
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
    VALUES ('alice', 'alice', '2026-09-25T00:00:00.000Z', '2026-09-25T00:00:00.000Z')`);
  state.database = d1(sqlite);
});
afterEach(() => sqlite.close());

const get = (handler: (request: Request) => Promise<Response>, path: string) => handler(new Request(`https://aura.test${path}`));

describe("preferences route", () => {
  it("returns defaults, saves a partial update, and rejects unknown fields", async () => {
    expect(await (await get(readPreferences, "/api/preferences")).json()).toMatchObject({ preferences: { notifications: { transactionEmail: true } } });
    const saved = await patchPreferences(new Request("https://aura.test/api/preferences", { method: "PATCH",
      body: JSON.stringify({ notifications: { transactionEmail: false } }) }));
    expect(saved.status).toBe(200);
    expect(await (await get(readPreferences, "/api/preferences")).json()).toMatchObject({
      preferences: { notifications: { transactionEmail: false } } });
    const invalid = await patchPreferences(new Request("https://aura.test/api/preferences", { method: "PATCH",
      body: JSON.stringify({ notifications: { productUpdatesEmail: true } }) }));
    expect(invalid.status).toBe(400);
  });
});
