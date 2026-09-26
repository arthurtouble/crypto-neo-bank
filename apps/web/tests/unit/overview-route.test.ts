import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, WalletOwnershipError } from "@/lib/http/errors";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const state = vi.hoisted(() => ({ db: null as D1Database | null, subject: "alice" as string | null, wallet: null as unknown, read: null as unknown }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => {
  if (!state.subject) throw new AuthenticationError();
  return { subjectReference: state.subject, sessionReference: "s" };
} }));
vi.mock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => {
  if (state.wallet instanceof Error) throw state.wallet;
  return state.wallet;
} }));
vi.mock("@/lib/overview/read", () => ({ readOverview: async (wallet: string) => {
  if (state.read instanceof Error) throw state.read;
  return { wallet, holdings: [], totals: { cash: { usdCents: 0, partial: false }, crypto: { usdCents: 0, partial: false },
    earn: { usdCents: 0, partial: false }, all: { usdCents: 0, partial: false } }, observedAt: "2026-09-26T12:00:00.000Z" };
} }));

const { GET } = await import("@/app/api/overview/route");
const wallet = "0x1111111111111111111111111111111111111111";
const get = () => GET(new Request("https://aura.test/api/overview"));
let sqlite: DatabaseSync;

describe("GET /api/overview", () => {
  beforeEach(() => { sqlite = schemaDatabase(); state.db = d1(sqlite); state.subject = "alice"; state.wallet = wallet; state.read = null; });
  afterEach(() => sqlite.close());

  it("returns the signed-in customer's own account, read from the chains", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ wallet, holdings: [], totals: { all: { usdCents: 0, partial: false } }, traceId: expect.any(String) });
  });

  it("refuses a request without a valid session", async () => {
    state.subject = null;
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
  });

  it("refuses when the customer has no Aura account wallet", async () => {
    state.wallet = new WalletOwnershipError();
    const response = await get();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "wallet_not_linked" });
  });

  it("reports the Overview unavailable when the account can't be looked up", async () => {
    state.wallet = new Error("privy down");
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "overview_unavailable" });
  });

  it("limits each customer to 60 reads a minute", async () => {
    for (let index = 0; index < 60; index++) expect((await get()).status).toBe(200);
    const limited = await get();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);
    state.subject = "bob";
    expect((await get()).status).toBe(200);
  });
});
