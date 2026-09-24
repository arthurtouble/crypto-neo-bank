import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0036_aura_tags.sql"), "utf8");

describe("Aura tag registry", () => {
  it("keeps old tags reserved and permits one active tag per owner", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(migration);
      const insert = db.prepare("INSERT INTO aura_tags (tag, subject_reference, receiving_address, display_name, public_enabled, active, created_at, updated_at) VALUES (?, ?, '0x000000000000000000000000000000000000dEaD', 'A', 1, 1, 'now', 'now')");
      insert.run("alice", "owner-a");
      expect(() => insert.run("alice2", "owner-a")).toThrow();
      db.exec("UPDATE aura_tags SET active = 0, public_enabled = 0 WHERE tag = 'alice'");
      insert.run("alice2", "owner-a");
      expect(() => insert.run("alice", "owner-b")).toThrow();
      expect(db.prepare("SELECT tag, active, public_enabled FROM aura_tags ORDER BY tag").all()).toEqual([
        { tag: "alice", active: 0, public_enabled: 0 },
        { tag: "alice2", active: 1, public_enabled: 1 }
      ]);
      db.exec(migration);
    } finally { db.close(); }
  });
});
