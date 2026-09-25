import { describe, expect, it } from "vitest";
import { schemaDatabase } from "../support/schema";

describe("Aura tag registry", () => {
  it("keeps old tags reserved and permits one active tag per owner", () => {
    const db = schemaDatabase();
    try {
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
      expect(db.prepare("SELECT public_bank_enabled FROM aura_tags WHERE tag = 'alice2'").get()).toEqual({ public_bank_enabled: 0 });
    } finally { db.close(); }
  });
});
