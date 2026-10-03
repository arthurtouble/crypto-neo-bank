import { beforeEach, describe, expect, it, vi } from "vitest";
import { providerRestrictedPlace, REGION_HEADER, requestPlace, withRegionHeader } from "@/lib/legal/places";

const calls = vi.hoisted(() => [] as string[]);
const done = (name: string) => async () => { calls.push(name); return {}; };
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/markets/guard", () => ({ marketActor: async () => ({ subject: "did:privy:alice", account: { address: "0x1111111111111111111111111111111111111111" } }) }));
vi.mock("@/lib/markets/perps", () => ({ placePerpsTrade: done("perps.trade"), placePerpsOrder: async () => { calls.push("perps.order"); return { statuses: [] }; },
  startPerpsSetup: done("perps.setup") }));
vi.mock("@/lib/markets/deposits", () => ({ buildPerpsDeposit: done("perps.deposit") }));
vi.mock("@/lib/markets/predictions", () => ({ startPredictionBuy: done("predictions.buy"), startPredictionsSetup: done("predictions.setup"),
  buildPredictionsDeposit: done("predictions.deposit") }));
vi.mock("@/lib/actions/prepare", () => ({ prepareBuiltAction: async () => ({ ok: false, block: { code: "stubbed", message: "stubbed" } }) }));

const routes = {
  "perps.trade": async () => (await import("@/app/api/perps/trade/route")).POST,
  "perps.order": async () => (await import("@/app/api/perps/orders/route")).POST,
  "perps.setup": async () => (await import("@/app/api/perps/setup/route")).POST,
  "perps.deposit": async () => (await import("@/app/api/perps/deposit/route")).POST,
  "predictions.buy": async () => (await import("@/app/api/predictions/orders/buy/route")).POST,
  "predictions.setup": async () => (await import("@/app/api/predictions/setup/route")).POST,
  "predictions.deposit": async () => (await import("@/app/api/predictions/deposit/route")).POST
};
const bodies: Record<keyof typeof routes, unknown> = {
  "perps.trade": { coin: "BTC", side: "long", marginUsd: "20", leverage: 2, isCross: true, type: "market" },
  "perps.order": { coin: "BTC", side: "buy", size: "0.001", type: "market" },
  "perps.setup": { agent: `0x${"9".repeat(40)}` },
  "perps.deposit": { amount: "10" },
  "predictions.buy": { marketId: "123", outcome: 0, amountUsd: 5 },
  "predictions.setup": undefined,
  "predictions.deposit": { amount: "10" }
};
const post = async (name: keyof typeof routes, country?: string, region?: string, body = bodies[name]) => {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(country ? { "CF-IPCountry": country } : {}), ...(region ? { [REGION_HEADER]: region } : {}) };
  return (await routes[name]())(new Request("https://aura.test/api/x", { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }));
};

beforeEach(() => { calls.length = 0; });

describe("provider place rules", () => {
  it("keeps each provider's own list", () => {
    for (const country of ["US", "PR", "GB", "FR", "DE", "AU", "SG", "JP", "IE", "NL", "KR"]) expect(providerRestrictedPlace("predictions", country, undefined), country).toBeTruthy();
    for (const region of ["ON", "QC", "BC", "AB"]) expect(providerRestrictedPlace("predictions", "CA", region), region).toBeTruthy();
    for (const country of ["ES", "PT", "AE", "MX", "MT", "CA"]) expect(providerRestrictedPlace("predictions", country, undefined), country).toBeUndefined();
    expect(providerRestrictedPlace("perps", "us", undefined)).toBe("the United States");
    expect(providerRestrictedPlace("perps", "CA", "ON")).toBe("Ontario");
    for (const [country, region] of [["CA", "QC"], ["GB", undefined], ["FR", undefined]]) expect(providerRestrictedPlace("perps", country, region)).toBeUndefined();
    expect(providerRestrictedPlace("stocks", "GB", undefined)).toBe("the United Kingdom");
    expect(providerRestrictedPlace("stocks", "VI", undefined)).toBe("the US Virgin Islands");
    expect(providerRestrictedPlace("stocks", "FR", undefined)).toBeUndefined();
    expect(providerRestrictedPlace("stocks", undefined, undefined)).toBeUndefined();
  });

  it("carries Cloudflare's region past the router, and never a client's", () => {
    const cloudflare = new Request("https://aura.test/api/x", { headers: { "CF-IPCountry": "CA", [REGION_HEADER]: "BC" } });
    Object.defineProperty(cloudflare, "cf", { value: { country: "CA", regionCode: "ON" } });
    expect(withRegionHeader(cloudflare).headers.get(REGION_HEADER)).toBe("ON");
    const spoofed = withRegionHeader(new Request("https://aura.test/api/x", { headers: { "CF-IPCountry": "CA", [REGION_HEADER]: "ON" } }));
    expect(spoofed.headers.get(REGION_HEADER)).toBeNull();
    expect(requestPlace(new Request("https://aura.test/api/x", { headers: { "CF-IPCountry": "CA", [REGION_HEADER]: "ON" } }))).toEqual({ country: "CA", region: "ON" });
  });
});

describe("starting something new in Perps and Predictions", () => {
  it("is refused with 451 from the provider's places, before anything is asked of it", async () => {
    for (const name of Object.keys(routes) as Array<keyof typeof routes>) {
      const response = await post(name, "US");
      expect(response.status, name).toBe(451);
      expect(await response.json(), name).toMatchObject({ error: "place_restricted", message: expect.stringContaining("aren't available where you are") });
    }
    expect((await post("perps.trade", "CA", "ON")).status).toBe(451);
    expect((await post("predictions.buy", "FR")).status).toBe(451);
    expect(calls).toEqual([]);
  });

  it("goes ahead elsewhere, and closing a perps position is allowed everywhere", async () => {
    expect((await post("perps.trade", "FR")).status).toBe(202);
    expect((await post("perps.setup", "CA", "QC")).status).toBe(200);
    expect((await post("predictions.buy", "ES")).status).toBe(200);
    expect((await post("predictions.setup")).status).toBe(200);
    expect((await post("perps.order", "US", undefined, { ...bodies["perps.order"] as object, side: "sell", reduceOnly: true })).status).toBe(202);
    expect(calls).toEqual(["perps.trade", "perps.setup", "predictions.buy", "predictions.setup", "perps.order"]);
  });
});
