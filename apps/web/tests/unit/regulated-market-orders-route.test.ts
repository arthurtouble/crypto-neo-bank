import { describe, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ env: {} }));
import type { CommandClaim } from "@aurel/provider-projections";
import { createOrdersHandler } from "@/app/api/markets/orders/route";
import { FeatureUnavailableError } from "@/lib/http/errors";
import { MarketOrderError } from "@/lib/markets/orders";

const request = {
  instrumentId: "xstocks:issuer-aapl", side: "buy", cashAmount: "1000", network: "Base",
  paymentWalletIdentifier: "0x1111111111111111111111111111111111111111",
  receivingWalletIdentifier: "0x1111111111111111111111111111111111111111",
  idempotencyKey: "0199b2c0-9c31-7000-8000-000000000001"
};
const post = (handler: ReturnType<typeof createOrdersHandler>, body: unknown = request) =>
  handler(new Request("https://aurel.example/api/markets/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

/** In-memory stand-in with the same claim semantics as command_idempotency. */
function commandStore() {
  const rows = new Map<string, { status: "in_progress" | "completed" | "failed"; providerObjectId: string | null }>();
  return {
    rows,
    claim: async (subjectReference: string, idempotencyKey: string): Promise<CommandClaim> => {
      const key = `${subjectReference}:market_order:${idempotencyKey}`;
      const row = rows.get(key);
      if (!row || row.status === "failed") { rows.set(key, { status: "in_progress", providerObjectId: null }); return { outcome: "claimed", key }; }
      return { outcome: row.status, key, providerObjectId: row.providerObjectId };
    },
    settle: async (key: string, result: { status: "completed" | "failed"; providerObjectId?: string }) => {
      rows.set(key, { status: result.status, providerObjectId: result.providerObjectId ?? null });
    }
  };
}

const base = () => ({ authenticate: async () => ({ subjectReference: "did:privy:subject-1" }), requireEnabled: async () => undefined, commands: commandStore() });

describe("regulated orders API", () => {
  it("returns explicit unavailable state without exposing wallet execution data", async () => {
    const deps = base();
    const POST = createOrdersHandler({ ...deps,
      createOrder: async () => { throw new MarketOrderError("venue_not_connected", "No contracted regulated execution venue is connected."); } });
    const response = await post(POST);
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: "venue_not_connected" });
    expect(JSON.stringify(body)).not.toMatch(/calldata|transactionRequest|signature/i);
    expect([...deps.commands.rows.values()]).toEqual([{ status: "failed", providerObjectId: null }]);
  });

  it("rejects a LI.FI-shaped executable payload before order creation", async () => {
    const deps = base();
    const POST = createOrdersHandler({ ...deps, createOrder: async () => { throw new Error("must not reach service"); } });
    const response = await post(POST, { ...request, transactionRequest: { to: request.paymentWalletIdentifier, data: "0x1234" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_order" });
    expect(deps.commands.rows.size).toBe(0);
  });

  it("refuses orders while tokenized markets are switched off, before creating anything", async () => {
    let created = 0;
    const POST = createOrdersHandler({ ...base(),
      requireEnabled: async () => { throw new FeatureUnavailableError("tokenized_markets"); },
      createOrder: async () => { created++; return { providerOrderReference: "never" }; } });
    const response = await post(POST);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "feature_unavailable" });
    expect(created).toBe(0);
  });

  it("sends an order to the venue once for a repeated idempotency key", async () => {
    let created = 0;
    const POST = createOrdersHandler({ ...base(), createOrder: async () => { created++; return { providerOrderReference: "venue-order-1" }; } });
    expect((await post(POST)).status).toBe(201);
    const repeat = await post(POST);
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ duplicate: true, order: { providerOrderReference: "venue-order-1" } });
    expect(created).toBe(1);
  });

  it("refuses a concurrent request with the same key while the first is in flight", async () => {
    const deps = base();
    await deps.commands.claim("did:privy:subject-1", request.idempotencyKey);
    const POST = createOrdersHandler({ ...deps, createOrder: async () => { throw new Error("must not reach venue"); } });
    const response = await post(POST);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "order_in_progress" });
  });

  it("lets the customer retry the same key after the venue rejected it", async () => {
    let attempts = 0;
    const POST = createOrdersHandler({ ...base(), createOrder: async () => {
      if (attempts++ === 0) throw new MarketOrderError("order_unavailable", "Try again.");
      return { providerOrderReference: "venue-order-2" };
    } });
    expect((await post(POST)).status).toBe(503);
    expect((await post(POST)).status).toBe(201);
    expect(attempts).toBe(2);
  });
});
