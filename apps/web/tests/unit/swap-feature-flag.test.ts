import { describe, expect, it } from "vitest";
import { featureEnabled, featureKeys, requireFeature, FeatureUnavailableError } from "@/lib/features/flags";

function database(enabled: number | null): D1Database {
  return {
    prepare: () => ({ bind: () => ({ first: async () => enabled === null ? null : { enabled } }) })
  } as unknown as D1Database;
}

describe("dedicated Swap kill switch", () => {
  it("is a known flag and defaults closed when migration is absent", async () => {
    expect(featureKeys).toContain("swaps");
    expect(await featureEnabled(database(null), "swaps")).toBe(false);
    await expect(requireFeature(database(null), "swaps")).rejects.toBeInstanceOf(FeatureUnavailableError);
  });

  it("can be switched on or off independently of direct transfers", async () => {
    expect(await featureEnabled(database(1), "swaps")).toBe(true);
    expect(await featureEnabled(database(0), "swaps")).toBe(false);
  });
});
