import { describe, expect, it } from "vitest";
import { customerSections, legacySectionDestination, navigation } from "@/lib/product-map";

describe("Aura product map", () => {
  it("exposes only the approved customer sections", () => {
    expect(customerSections).toEqual([
      "deposit", "send", "swap", "earn", "borrow", "invest", "cards",
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
    expect(legacySectionDestination("operations")).toBeNull();
  });
});
