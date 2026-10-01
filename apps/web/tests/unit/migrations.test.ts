import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationsDirectory } from "../support/schema";

/**
 * Migrations applied to a real database (dev since 28 September 2026), with
 * each file's SHA-256. An applied migration never changes: change the schema
 * with the next numbered file, apply it, then add it here.
 */
const APPLIED: Record<string, string> = {
  "0001_baseline.sql": "e4753039344c01f53cad5794edb7d6a004ded7ac1d6123ec446856591bcf63a3",
  "0002_incoming_observations.sql": "dbdbdfed897eff33a534c9b473d0da36da35817856f0f695d3ad77b3f79d85a4",
  "0003_card_observations.sql": "e7eebc12427d1fbe9a533e3888b7759167916742731ce2db7e82cb56d1e425e7",
  "0004_notification_delivery_claims.sql": "38695fb639bfad69142c64daaeb5f202511fc2ddd75c2c6b18986ce554642996",
  "0005_bank_beneficiary_available_at.sql": "605be999f10c14c4795a98bad5258ed0a4c56f43eb4aec1e0bf3f48e559ff10a"
};

const files = readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
const sha256 = (name: string) => createHash("sha256").update(readFileSync(resolve(migrationsDirectory, name))).digest("hex");

describe("migrations", () => {
  it("are numbered in order from 0001, with no gaps", () => {
    files.forEach((name, index) => expect(name).toMatch(new RegExp(`^${String(index + 1).padStart(4, "0")}_[a-z0-9_]+\\.sql$`)));
  });

  it("never change once applied", () => {
    for (const [name, hash] of Object.entries(APPLIED)) {
      expect(files, `${name} was applied and must stay`).toContain(name);
      expect(sha256(name), `${name} was applied; add a new numbered migration instead of editing it`).toBe(hash);
    }
  });
});
