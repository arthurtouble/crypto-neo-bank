import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const fixture = vi.hoisted(() => ({ db: null as D1Database | null, authenticated: true, rateLimited: false }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return fixture.db; } } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: httpErrors.AuthenticationError, requireVerifiedSubject: async () => {
  if (!fixture.authenticated) throw new httpErrors.AuthenticationError();
  return { subjectReference: "did:privy:owner" };
} }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: httpErrors.RateLimitError,
  enforceRateLimit: async () => { if (fixture.rateLimited) throw new httpErrors.RateLimitError(30); } }));

const { GET } = await import("@/app/api/swap/assets/route");
const request = (query: string) => GET(new Request(`https://aurel.test/api/swap/assets${query}`));
const baseUsdc = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("Swap asset catalog API", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => { sqlite = schemaDatabase(); fixture.db = d1(sqlite); fixture.authenticated = true; fixture.rateLimited = false; });
  afterEach(() => sqlite.close());

  it("lists only the registry's swappable assets, searchable by symbol, name, or contract, without caching", async () => {
    const response = await request("?q=usd&chainIds=8453,1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json() as { assets: Array<{ id: string; eligibility: string }>; source: string };
    expect(body.source).toBe("Aura registry");
    expect(body.assets.map((asset) => asset.id)).toEqual([baseUsdc, "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]);
    expect(body.assets.every((asset) => asset.eligibility === "eligible")).toBe(true);
    const byContract = await (await request("?q=0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf&chainIds=8453")).json() as { assets: Array<{ symbol: string }> };
    expect(byContract.assets.map((asset) => asset.symbol)).toEqual(["cbBTC"]);
  });

  it("lists only what the account can hold for the side that pays", async () => {
    const all = await (await request("?q=usdc")).json() as { assets: Array<{ id: string }> };
    const held = await (await request("?q=usdc&held=1")).json() as { assets: Array<{ id: string }> };
    expect(all.assets.length).toBe(5);
    expect(held.assets.map((asset) => asset.id)).toEqual([baseUsdc]);
    const gold = await (await request("?q=gold&held=1")).json() as { assets: Array<{ id: string }> };
    expect(gold.assets.map((asset) => asset.id)).toEqual(["1:0x68749665ff8d2d112fa859aa293f07a622782f38"]);
    expect((await request("?q=x&held=yes")).status).toBe(400);
  });

  it("never finds a contract outside the registry, even by exact address", async () => {
    const unknown = await request("?import=8453:0x1111111111111111111111111111111111111111");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "asset_not_found" });
    const search = await (await request("?q=0x1111111111111111111111111111111111111111")).json() as { assets: unknown[] };
    expect(search.assets).toEqual([]);
    expect(await (await request(`?import=${baseUsdc}`)).json()).toMatchObject({ asset: { id: baseUsdc, symbol: "USDC" } });
  });

  it("says whether swaps are switched on, on one network and between networks", async () => {
    sqlite.exec("UPDATE feature_flags SET enabled = CASE flag_key WHEN 'swaps' THEN 1 ELSE 0 END");
    expect(await (await request(`?import=${baseUsdc}`)).json()).toMatchObject({ switches: { sameNetwork: true, otherNetwork: false } });
    sqlite.exec("UPDATE feature_flags SET enabled = CASE flag_key WHEN 'cross_chain' THEN 1 ELSE 0 END");
    expect(await (await request("?q=usdc")).json()).toMatchObject({ switches: { sameNetwork: false, otherNetwork: true } });
  });

  it("says up front where stocks can't be bought, from the request's place", async () => {
    const from = (country: string, query: string) => GET(new Request(`https://aurel.test/api/swap/assets${query}`, { headers: { "CF-IPCountry": country } }));
    expect(await (await from("GB", `?import=${baseUsdc}`)).json()).toMatchObject({ places: { stocks: "Stocks aren't available where you are. You can still sell or send the ones you hold." } });
    expect(await (await from("US", "?q=apple")).json()).toMatchObject({ places: { stocks: expect.stringContaining("Stocks aren't available") } });
    expect(await (await from("CH", "?q=apple")).json()).toMatchObject({ places: { stocks: null } });
    expect(await (await request("?q=apple")).json()).toMatchObject({ places: { stocks: null } });
  });

  it("lists a paused asset as unavailable", async () => {
    sqlite.exec(`INSERT INTO asset_pauses (asset_id, reason, paused_at, paused_by) VALUES ('${baseUsdc}', 'Depeg', '2026-09-26T00:00:00Z', 'op')`);
    const body = await (await request(`?import=${baseUsdc}`)).json() as { asset: { eligibility: string; unavailableReason: string } };
    expect(body.asset).toMatchObject({ eligibility: "unavailable", unavailableReason: "USDC is paused right now." });
  });

  it("rejects invalid queries and unsupported networks", async () => {
    for (const query of ["?q=x&chainIds=56", "?q=x&chainIds=abc", `?q=${"x".repeat(121)}`, "?q=x&cursor=abc", "?import=8453:javascript:alert(1)"]) {
      expect((await request(query)).status, query).toBe(400);
    }
  });

  it("requires a session and applies the rate limit", async () => {
    fixture.authenticated = false; expect((await request("?q=ETH")).status).toBe(401);
    fixture.authenticated = true; fixture.rateLimited = true; expect((await request("?q=ETH")).status).toBe(429);
  });
});
