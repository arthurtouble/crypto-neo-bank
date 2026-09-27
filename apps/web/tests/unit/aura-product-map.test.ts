import { describe, expect, it } from "vitest";
import { customerSections, legacySectionDestination, navigation } from "@/lib/product-map";

describe("Aura product map", () => {
  it("exposes only the approved customer sections", () => {
    expect(customerSections).toEqual([
      "deposit", "send", "swap", "earn", "cards",
      "rewards", "transactions", "insights", "settings", "support"
    ]);
    expect(navigation.flatMap((group) => group.items.map((item) => item.href))).toEqual([
      "/app", ...customerSections.map((section) => `/app/${section}`)
    ]);
  });

  it("maps old bookmarks without restoring removed customer features", () => {
    expect(legacySectionDestination("transfers")).toBe("/app/deposit");
    expect(legacySectionDestination("goals")).toBe("/app");
    expect(legacySectionDestination("concierge")).toBe("/app/support");
    expect(legacySectionDestination("borrow")).toBe("/app/earn");
    // Invest was cut: stocks, gold, and crypto are bought in Swap.
    expect(legacySectionDestination("invest")).toBe("/app/swap");
    expect(legacySectionDestination("markets")).toBe("/app/swap");
    expect(legacySectionDestination("operations")).toBeNull();
  });
});
