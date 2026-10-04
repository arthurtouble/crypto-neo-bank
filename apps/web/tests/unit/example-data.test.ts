import { describe, expect, it } from "vitest";
import { buildInsights } from "@/lib/insights/presentation";
import { exampleActivity, exampleCard, exampleHistory, exampleNow, exampleOverview, exampleRecipients } from "@/lib/example/data";

describe("guest example data", () => {
  it("adds up, so an example screen never shows impossible totals", () => {
    for (const group of ["cash", "crypto", "earn", "all"] as const) {
      const sum = exampleOverview.holdings.filter((item) => group === "all" || item.group === group).reduce((total, item) => total + (item.usdCents ?? 0), 0);
      expect(exampleOverview.totals[group].usdCents, group).toBe(sum);
    }
  });

  it("uses only obviously fictional addresses and marks every source as an example", () => {
    const addresses = [exampleOverview.wallet, ...exampleRecipients.map((item) => item.destination),
      ...exampleHistory.map((item) => item.counterparty).filter((item) => item?.startsWith("0x"))];
    for (const address of addresses) expect(address).toMatch(/^0x0{36}e0[a-f0-9]{2}$/);
    expect(exampleOverview.holdings.every((item) => item.source === "example")).toBe(true);
  });

  it("shows the same card payments on Transactions as on Cards", () => {
    for (const payment of exampleCard.activity) {
      const entry = exampleHistory.find((item) => item.type === "card_payment" && item.createdAt === payment.createdAt);
      expect(entry, payment.merchant ?? undefined).toMatchObject({ counterparty: payment.merchant, amount: payment.amountUsd, asset: "USD",
        status: payment.status === "declined" ? "failed" : "completed" });
    }
    expect(exampleHistory.find((item) => item.counterparty === "Corner Cafe")).toMatchObject({ amount: "12.00" });
  });

  it("is newest first, labelled as examples, and the Overview's recent list is its first rows", () => {
    expect([...exampleHistory].sort((a, b) => b.createdAt.localeCompare(a.createdAt))).toEqual(exampleHistory);
    expect(new Set(exampleHistory.map((item) => item.id)).size).toBe(exampleHistory.length);
    expect(exampleHistory.every((item) => item.source === "example")).toBe(true);
    expect(exampleActivity).toEqual(exampleHistory.slice(0, 3));
  });

  it("adds up to the guest summary, leaving the declined payment out", () => {
    const summary = buildInsights(exampleHistory, exampleNow, 30);
    // Since 16 December 2025: received 500 + 1,200; sent 250 and card 12 + 30 + 7.60 + 64; Earn 155; swapped 100.
    expect(summary.totals).toEqual({ incoming: 1700, outgoing: 363.6, allocation: 155, movement: 100, unvalued: 0 });
    expect(summary.topMerchants[0]).toEqual({ name: "Grocer", total: 64, payments: 1 });
  });
});
