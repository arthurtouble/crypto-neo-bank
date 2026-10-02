import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ marketCalls: 0, args: [] as unknown[] }));
vi.mock("@/lib/defi/aave", () => ({
  getAaveBaseMarkets: async (...args: unknown[]) => { state.marketCalls++; state.args = args; return {}; },
}));

import { GET as markets } from "@/app/api/defi/aave/markets/route";

const request = (path: string) => new Request(`https://aura.test${path}`);

describe("Aave read boundaries", () => {
  beforeEach(() => Object.assign(state, { marketCalls: 0, args: [] }));

  it("serves general market data publicly and cacheably", async () => {
    const response = await markets(request("/api/defi/aave/markets"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(state.marketCalls).toBe(1);
  });

  it("never sends an account's address to Aave's data service", async () => {
    await markets(request("/api/defi/aave/markets?address=0x2222222222222222222222222222222222222222"));
    expect(state.args).toEqual([]);
  });
});
