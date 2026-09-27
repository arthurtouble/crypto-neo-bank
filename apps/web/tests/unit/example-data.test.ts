import { describe, expect, it } from "vitest";
import { exampleOverview, exampleRecipients } from "@/lib/example/data";

describe("guest example data", () => {
  it("adds up, so an example screen never shows impossible totals", () => {
    for (const group of ["cash", "crypto", "earn", "all"] as const) {
      const sum = exampleOverview.holdings.filter((item) => group === "all" || item.group === group).reduce((total, item) => total + (item.usdCents ?? 0), 0);
      expect(exampleOverview.totals[group].usdCents, group).toBe(sum);
    }
  });

  it("uses only obviously fictional addresses and marks every source as an example", () => {
    const addresses = [exampleOverview.wallet, ...exampleRecipients.map((item) => item.destination)];
    for (const address of addresses) expect(address).toMatch(/^0x0{36}e0[a-f0-9]{2}$/);
    expect(exampleOverview.holdings.every((item) => item.source === "example")).toBe(true);
  });
});
