import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const upgrade = readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0035_growth_waitlist_upgrade.sql"), "utf8");

describe("waitlist upgrade for existing D1 databases", () => {
  it("adds waitlist storage without deleting legacy applications", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE beta_invites (code_hash TEXT PRIMARY KEY); CREATE TABLE growth_applications (application_id TEXT PRIMARY KEY); CREATE TABLE growth_consent_events (subject_reference TEXT, purpose TEXT, occurred_at TEXT); INSERT INTO growth_applications VALUES ('legacy-1');");
      db.exec(upgrade);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('growth_waitlist','growth_waitlist_invites') ORDER BY name").all())
        .toEqual([{ name: "growth_waitlist" }, { name: "growth_waitlist_invites" }]);
      expect(db.prepare("SELECT application_id FROM growth_applications").get()).toEqual({ application_id: "legacy-1" });
      db.exec(upgrade);
    } finally { db.close(); }
  });
});
