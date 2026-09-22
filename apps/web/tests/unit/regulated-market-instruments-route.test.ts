import { describe, expect, it } from "vitest";
import { createInstrumentsHandler } from "@/app/api/markets/instruments/route";
import { XstocksCatalogError } from "@/lib/markets/xstocks";

const page = { instruments: [{ id: "xstocks:issuer-aapl", availability: { status: "view_only", reason: "partner_not_connected" } }], nextCursor: null, observedAt: "2026-09-22T12:00:00.000Z", expiresAt: "2026-09-22T12:05:00.000Z", source: "xstocks_public" as const };

describe("regulated market instrument API", () => {
  it("serves read-only public identity without a customer eligibility claim", async () => {
    const GET = createInstrumentsHandler(async () => page);

    const response = await GET(new Request("https://aurel.example/api/markets/instruments?q=AAPL"));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect(body).not.toHaveProperty("eligible");
    expect(JSON.stringify(body)).not.toMatch(/can(?:Quote|Order|Trade)|eligible/i);
    expect(body).toMatchObject({ authority: "Public issuer metadata for discovery only; not customer eligibility or execution authority" });
  });

  it("rejects malformed searches and maps source outages to a fail-closed response", async () => {
    const success = createInstrumentsHandler(async () => page);
    expect((await success(new Request(`https://aurel.example/api/markets/instruments?q=${"x".repeat(121)}`))).status).toBe(400);

    const unavailable = createInstrumentsHandler(async () => { throw new XstocksCatalogError("provider_unavailable"); });
    const response = await unavailable(new Request("https://aurel.example/api/markets/instruments"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "instrument_catalog_unavailable" });
  });
});
