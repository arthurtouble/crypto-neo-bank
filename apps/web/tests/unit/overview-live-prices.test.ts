import { afterEach, describe, expect, it, vi } from "vitest";

// The live clients, with the clock moving while they are set up: a read that takes a few milliseconds.
vi.mock("@/lib/chain/rpc", () => ({ publicClient: () => {
  vi.setSystemTime(Date.now() + 5);
  return { getBalance: async () => 2n * 10n ** 18n, readContract: async () => 0n };
} }));
vi.mock("@/lib/actions/valuation", () => ({ krakenUsd: async () => "2500" }));
vi.mock("@/lib/assets/prices", () => ({ chainlinkUsd: async () => null }));

const { readOverview } = await import("@/lib/overview/read");

afterEach(() => { vi.useRealTimers(); });

describe("live crypto prices on the overview", () => {
  it("carry the overview's own read time, so they never show a price time", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-02T10:51:00.000Z") });
    const overview = await readOverview("0x1111111111111111111111111111111111111111");
    const ether = overview.holdings.find((holding) => holding.id === "8453:native");
    expect(ether).toMatchObject({ status: "observed", usdCents: 500_000 });
    expect(ether?.priceObservedAt).toBeUndefined();
  });
});
