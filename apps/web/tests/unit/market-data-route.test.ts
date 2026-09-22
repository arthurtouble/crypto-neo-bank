import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as Array<{ page: number; size: number; search: string }> }));
vi.mock("@/lib/markets/data", () => ({
  getMarketsPage: async (page: number, size: number, search: string) => {
    state.calls.push({ page, size, search });
    return { markets: [{ id: "aave-usd", name: "Aave", symbol: "aave" }], total: 1 };
  },
  getMarketHistory: async () => ({ prices: [] })
}));

import { GET } from "@/app/api/market-data/route";

describe("public market discovery", () => {
  it("passes full-catalog search to the source before pagination", async () => {
    state.calls = [];
    const response = await GET(new Request("https://aurel.test/api/market-data?page=2&search=Aave"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ page: 2, total: 1, markets: [{ id: "aave-usd" }] });
    expect(state.calls).toEqual([{ page: 2, size: 50, search: "Aave" }]);
  });

  it("rejects invalid paging and unbounded search without fetching a provider", async () => {
    state.calls = [];
    expect((await GET(new Request("https://aurel.test/api/market-data?page=NaN"))).status).toBe(400);
    expect((await GET(new Request(`https://aurel.test/api/market-data?search=${"x".repeat(81)}`))).status).toBe(400);
    expect((await GET(new Request(`https://aurel.test/api/market-data?search=${encodeURIComponent(" ".repeat(81))}`))).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
});
