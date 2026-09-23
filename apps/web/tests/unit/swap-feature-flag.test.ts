import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { featureEnabled, featureKeys, requireFeature, FeatureUnavailableError } from "@/lib/features/flags";

function database(enabled: number | null, audience = "beta"): D1Database {
  return {
    prepare: () => ({ bind: () => ({ first: async () => enabled === null ? null : { enabled, audience } }) })
  } as unknown as D1Database;
}

describe("dedicated Swap kill switch", () => {
  it.each(["direct_transfers", "cross_chain", "defi_actions"] as const)("fails closed when the %s flag row is missing", async (key) => {
    expect(await featureEnabled(database(null), key)).toBe(false);
    await expect(requireFeature(database(null), key)).rejects.toBeInstanceOf(FeatureUnavailableError);
  });

  it("is a known flag and defaults closed when migration is absent", async () => {
    expect(featureKeys).toContain("swaps");
    expect(await featureEnabled(database(null), "swaps")).toBe(false);
    await expect(requireFeature(database(null), "swaps")).rejects.toBeInstanceOf(FeatureUnavailableError);
  });

  it("can be switched on or off independently of direct transfers", async () => {
    expect(await featureEnabled(database(1), "swaps")).toBe(true);
    expect(await featureEnabled(database(0), "swaps")).toBe(false);
  });

  it("does not expose an operations-only flag to customer routes", async () => {
    expect(await featureEnabled(database(1, "operations"), "direct_transfers")).toBe(false);
    await expect(requireFeature(database(1, "operations"), "direct_transfers")).rejects.toBeInstanceOf(FeatureUnavailableError);
  });

  it("leaves every money-movement flag disabled in a fresh migrated database", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const directory = resolve(process.cwd(), "../../infra/d1/migrations");
      for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
        db.exec(readFileSync(resolve(directory, name), "utf8"));
      }
      const rows = db.prepare(`SELECT flag_key, enabled FROM feature_flags
        WHERE flag_key IN ('direct_transfers', 'swaps', 'cross_chain', 'defi_actions') ORDER BY flag_key`).all();
      expect(rows).toEqual([
        { flag_key: "cross_chain", enabled: 0 },
        { flag_key: "defi_actions", enabled: 0 },
        { flag_key: "direct_transfers", enabled: 0 },
        { flag_key: "swaps", enabled: 0 }
      ]);
    } finally { db.close(); }
  });
});
