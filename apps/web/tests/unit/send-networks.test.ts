import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendDestinations } from "@/lib/assets/registry";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const wallet = "0x1111111111111111111111111111111111111111";
const friend = "0x2222222222222222222222222222222222222222";
const baseUsdc = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const arbUsdc = "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831";

const state = vi.hoisted(() => ({ db: null as D1Database | null, quoted: [] as Array<{ recipient: string }> }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: httpErrors.AuthenticationError, requireVerifiedSubject: async () => ({ subjectReference: "did:privy:alice" }) }));
vi.mock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => wallet }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: httpErrors.RateLimitError, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/actions/lifi", async (original) => ({ ...await original<typeof import("@/lib/actions/lifi")>(),
  quoteRoute: async (request: { recipient: string }) => {
    state.quoted.push(request);
    return { tool: "across", fromAmountRaw: "10000000", toAmountRaw: "9950000", toAmountMinRaw: "9900000", expiresAt: "2099-01-01T00:00:00.000Z",
      calls: [{ to: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", value: "0", data: "0xabcdef01" }], effects: [],
      economics: { fromAmountUsd: "10.00", toAmountUsd: "9.95", networkFeeUsd: 0.01, providerFeeUsd: 0.04, priceImpactPercent: 0.5 } };
  } }));

const { GET } = await import("@/app/api/routes/quote/route");
const { GET: listRecipients } = await import("@/app/api/recipients/route");
const { ensureSubjectProfile } = await import("@/lib/profile/ensure");
const quote = (recipient?: string) => GET(new Request(`https://aura.test/api/routes/quote?${new URLSearchParams({ from: baseUsdc, to: arbUsdc, amount: "10", ...(recipient ? { recipient } : {}) })}`));

describe("where a Base asset can be sent", () => {
  it("offers Base, then every network where the same asset is registered to be received", () => {
    const names = (id: string) => sendDestinations(id).map((item) => item.name);
    expect(names(baseUsdc)).toEqual(["Base", "Ethereum", "Arbitrum", "Optimism", "Polygon"]);
    expect(names("8453:native")).toEqual(["Base", "Ethereum", "Arbitrum", "Optimism"]);
    expect(names("8453:0x4200000000000000000000000000000000000006")).toEqual(["Base"]);
    expect(names("8453:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf")).toEqual(["Base"]);
    expect(sendDestinations(baseUsdc).find((item) => item.name === "Arbitrum")?.asset.id).toBe(arbUsdc);
    expect(sendDestinations(arbUsdc)).toEqual([]);
  });
});

describe("GET /api/routes/quote for a send to another network", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => { sqlite = schemaDatabase(); state.db = d1(sqlite); state.quoted = []; sqlite.exec("UPDATE feature_flags SET enabled = 0"); });
  afterEach(() => sqlite.close());

  it("needs the cross-network switch, and the send switch too when it pays someone else", async () => {
    expect((await quote()).status).toBe(503);
    sqlite.exec("UPDATE feature_flags SET enabled = 1 WHERE flag_key = 'cross_chain'");
    expect((await quote()).status).toBe(200);
    expect((await quote(friend)).status).toBe(503);
    sqlite.exec("UPDATE feature_flags SET enabled = 1 WHERE flag_key = 'direct_transfers'");
    const response = await quote(friend);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ quote: { recipient: friend, toAmountRaw: "9950000", toAmountMinRaw: "9900000" } });
    expect(state.quoted.map((item) => item.recipient)).toEqual([wallet, friend]);
  });

  it("refuses a token contract as the recipient before LI.FI is asked", async () => {
    sqlite.exec("UPDATE feature_flags SET enabled = 1");
    const response = await quote("0xaf88d065e77c8cc2239327c5edb3a432268e5831");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "invalid_recipient" });
    expect(state.quoted).toEqual([]);
  });
});

describe("recent recipients", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => { sqlite = schemaDatabase(); state.db = d1(sqlite); });
  afterEach(() => sqlite.close());

  function action(kind: "transfer" | "route", summary: Record<string, unknown>, createdAt: string) {
    sqlite.prepare(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint,
        effects_json, counts_toward_limit, status, created_at, expires_at, updated_at)
      VALUES (?, 'did:privy:alice', ?, ?, 8453, ?, '[{"to":"0x1","value":"0","data":"0x"}]', ?, '[]', 1, 'confirmed', ?, ?, ?)`)
      .run(crypto.randomUUID(), wallet, kind, JSON.stringify(summary), crypto.randomUUID(), createdAt, createdAt, createdAt);
  }

  it("include sends to other networks, but not moves to the customer's own account", async () => {
    await ensureSubjectProfile(state.db!, "did:privy:alice");
    const onBase = "0x3333333333333333333333333333333333333333";
    action("transfer", { to: onBase }, "2026-09-27T09:00:00.000Z");
    action("route", { recipient: friend }, "2026-09-27T10:00:00.000Z");
    action("route", { recipient: wallet }, "2026-09-27T11:00:00.000Z");
    const body = await (await listRecipients(new Request("https://aura.test/api/recipients"))).json() as { recipients: Array<{ destination: string; recent?: boolean }> };
    expect(body.recipients.filter((item) => item.recent).map((item) => item.destination)).toEqual([friend, onBase]);
  });
});
