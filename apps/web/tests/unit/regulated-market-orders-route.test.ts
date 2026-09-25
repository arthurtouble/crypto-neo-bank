import { describe, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ env: {} }));
import { createOrdersHandler } from "@/app/api/markets/orders/route";
import { FeatureUnavailableError } from "@/lib/http/errors";
import { MarketOrderError } from "@/lib/markets/orders";

const request = {
  instrumentId: "xstocks:issuer-aapl", side: "buy", cashAmount: "1000", network: "Base",
  paymentWalletIdentifier: "0x1111111111111111111111111111111111111111",
  receivingWalletIdentifier: "0x1111111111111111111111111111111111111111",
  idempotencyKey: "0199b2c0-9c31-7000-8000-000000000001"
};

describe("regulated orders API", () => {
  it("returns explicit unavailable state without exposing wallet execution data", async () => {
    const POST = createOrdersHandler({
      authenticate: async () => ({ subjectReference: "did:privy:subject-1" }), requireEnabled: async () => undefined,
      createOrder: async () => { throw new MarketOrderError("venue_not_connected", "No contracted regulated execution venue is connected."); }
    });
    const response = await POST(new Request("https://aurel.example/api/markets/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: "venue_not_connected" });
    expect(JSON.stringify(body)).not.toMatch(/calldata|transactionRequest|signature/i);
  });

  it("rejects a LI.FI-shaped executable payload before order creation", async () => {
    const POST = createOrdersHandler({
      authenticate: async () => ({ subjectReference: "did:privy:subject-1" }), requireEnabled: async () => undefined,
      createOrder: async () => { throw new Error("must not reach service"); }
    });
    const response = await POST(new Request("https://aurel.example/api/markets/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, transactionRequest: { to: request.paymentWalletIdentifier, data: "0x1234" } }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_order" });
  });

  it("refuses orders while tokenized markets are switched off, before creating anything", async () => {
    let created = 0;
    const POST = createOrdersHandler({
      authenticate: async () => ({ subjectReference: "did:privy:subject-1" }),
      requireEnabled: async () => { throw new FeatureUnavailableError("tokenized_markets"); },
      createOrder: async () => { created++; return {}; }
    });
    const response = await POST(new Request("https://aurel.example/api/markets/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "feature_unavailable" });
    expect(created).toBe(0);
  });
});
