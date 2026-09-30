import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
const state = vi.hoisted(() => ({ db: null as D1Database | null }));
const wallet = "0x1111111111111111111111111111111111111111";
const depositAddress = "0x9999999999999999999999999999999999999999";
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "s" }) }));
vi.mock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => wallet, requireMoneyMfa: async () => undefined,
  requireMoneyAccount: async () => ({ address: wallet, walletId: "wallet-1" }), WalletOwnershipError: httpErrors.WalletOwnershipError }));

const { POST: onboard } = await import("@/app/api/money/onboarding/route");
const { GET: account } = await import("@/app/api/money/account/route");
const { POST: addBank } = await import("@/app/api/money/bank-accounts/route");
const { POST: payout } = await import("@/app/api/money/payouts/route");

type Call = { url: string; method: string; body: Record<string, unknown> | null; idempotencyKey: string | null };
let sqlite: DatabaseSync;
let calls: Call[];
let activated = false;
let payoutAmount = "25.0";
let kycCustomerId: string | null = null;

const activeAccount = { id: "va_1", customer_id: "cust_1", status: "activated", source_deposit_instructions: { currency: "usd",
  payment_rails: ["ach_push"], bank_name: "Lead Bank", bank_beneficiary_name: "Alice", bank_account_number: "123456789", bank_routing_number: "876543210" } };

function bridge(url: string, init: RequestInit = {}) {
  const path = new URL(url).pathname.replace("/v0", "");
  const method = init.method ?? "GET";
  calls.push({ url: path, method, body: init.body ? JSON.parse(String(init.body)) : null,
    idempotencyKey: new Headers(init.headers).get("Idempotency-Key") });
  // Bridge creates the customer only after verification, so the link starts without one.
  if (path === "/kyc_links" || path === "/kyc_links/kyc_1") return Response.json({ id: "kyc_1", customer_id: kycCustomerId, kyc_link: "https://bridge.test/kyc",
    tos_link: "https://bridge.test/tos", kyc_status: kycCustomerId ? "approved" : "not_started", tos_status: kycCustomerId ? "approved" : "pending" });
  if (path.endsWith("/virtual_accounts") && method === "GET") return Response.json({ data: activated ? [activeAccount] : [] });
  if (path.endsWith("/virtual_accounts")) { activated = true; return Response.json(activeAccount); }
  if (path.endsWith("/external_accounts")) return Response.json({ id: "ea_1", bank_name: "Lead Bank", active: true, account: { last_4: "6789", routing_number: "876543210" } }, { status: 201 });
  if (path === "/transfers") return Response.json({ id: "tr_1", state: "awaiting_funds", source_deposit_instructions: {
    payment_rail: "base", currency: "usdc", to_address: depositAddress, amount: payoutAmount } });
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec("UPDATE feature_flags SET enabled = 1");
  state.db = d1(sqlite);
  calls = []; activated = false; payoutAmount = "25.0"; kycCustomerId = null;
  vi.stubEnv("BRIDGE_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => bridge(url, init)));
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const bankAccount = { accountOwnerName: "Alice Example", bankName: "Lead Bank", accountNumber: "123456789", routingNumber: "876543210",
  checkingOrSavings: "checking", address: { streetLine1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "USA" } };

describe("bank account setup", () => {
  it("stays off without the switch or the key", async () => {
    sqlite.exec("UPDATE feature_flags SET enabled = 0 WHERE flag_key = 'fiat_accounts'");
    expect(await (await account(new Request("https://aura.test/api/money/account"))).json()).toMatchObject({ available: false });
    expect((await onboard(new Request("https://aura.test", json({ fullName: "Alice Example", email: "alice@example.com" })))).status).toBe(503);
    expect(calls).toEqual([]);
  });

  it("starts Bridge verification once per customer and records the link as pending", async () => {
    const response = await onboard(new Request("https://aura.test", json({ fullName: "Alice Example", email: "alice@example.com" })));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ verificationUrl: "https://bridge.test/kyc", termsUrl: "https://bridge.test/tos" });
    expect(calls[0]).toMatchObject({ url: "/kyc_links", method: "POST", idempotencyKey: expect.stringMatching(/^kyc-link:alice:[0-9a-f]{32}$/),
      body: { full_name: "Alice Example", email: "alice@example.com", type: "individual" } });
    expect(sqlite.prepare("SELECT external_customer_id, onboarding_reference, status, onboarding_url FROM provider_customer_links").get())
      .toEqual({ external_customer_id: null, onboarding_reference: "kyc_1", status: "pending", onboarding_url: "https://bridge.test/kyc" });
    expect(await (await account(new Request("https://aura.test/api/money/account"))).json())
      .toMatchObject({ available: true, nextAction: { type: "continue_verification", url: "https://bridge.test/kyc" } });
  });

  it("picks up the customer Bridge created and opens the USD account into the smart wallet", async () => {
    await onboard(new Request("https://aura.test", json({ fullName: "Alice Example", email: "alice@example.com" })));
    kycCustomerId = "cust_1";
    const body = await (await account(new Request("https://aura.test/api/money/account"))).json() as { account: { state: string; depositInstructions: unknown } };
    expect(body.account).toMatchObject({ state: "active", depositInstructions: { accountNumber: "123456789" } });
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/virtual_accounts"))?.body)
      .toEqual({ source: { currency: "usd" }, destination: { currency: "usdc", payment_rail: "base", address: wallet } });
    expect(sqlite.prepare("SELECT external_customer_id, status FROM provider_customer_links").get()).toEqual({ external_customer_id: "cust_1", status: "active" });
  });
});

describe("bank payouts", () => {
  beforeEach(async () => {
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');
      INSERT INTO security_profiles (subject_reference, updated_at) VALUES ('alice', 't');
      INSERT INTO provider_customer_links (subject_reference, provider, external_customer_id, status, created_at, updated_at) VALUES ('alice', 'bridge', 'cust_1', 'active', 't', 't');`);
  });
  const savedBankId = async () => {
    expect((await addBank(new Request("https://aura.test", json(bankAccount)))).status).toBe(201);
    return (sqlite.prepare("SELECT beneficiary_id FROM bank_beneficiary_projections").get() as { beneficiary_id: string }).beneficiary_id;
  };

  it("keeps only Bridge's reference and the last four digits of a saved account", async () => {
    await savedBankId();
    expect(sqlite.prepare("SELECT provider_beneficiary_reference, display_name, account_hint FROM bank_beneficiary_projections").get())
      .toEqual({ provider_beneficiary_reference: "ea_1", display_name: "Lead Bank", account_hint: "•••• 6789" });
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM bank_beneficiary_projections").all())).not.toContain("123456789");
  });

  it("turns a Bridge payout into a USDC transfer action to the address Bridge returned", async () => {
    // Bridge writes "25.0" for "25.00"; the amounts are equal.
    const response = await payout(new Request("https://aura.test", json({ bankAccountId: await savedBankId(), amountUsd: "25.00" })));
    expect(response.status).toBe(201);
    const { action } = await response.json() as { action: { calls: Array<{ data: `0x${string}` }>; summary: Record<string, unknown>; usdCents: number } };
    expect(decodeFunctionData({ abi: erc20Abi, data: action.calls[0].data }).args).toEqual([depositAddress, 25_000_000n]);
    expect(action).toMatchObject({ usdCents: 2500, summary: { bankPayout: { transferId: "tr_1", lastFour: "6789" } } });
    expect(calls.find((call) => call.url === "/transfers")?.body).toMatchObject({ on_behalf_of: "cust_1", amount: "25.00",
      source: { payment_rail: "base", currency: "usdc", from_address: wallet }, destination: { payment_rail: "ach", external_account_id: "ea_1" } });
  });

  it("refuses a paused asset or a switched-off feature before Bridge creates anything", async () => {
    const bankAccountId = await savedBankId();
    sqlite.exec("INSERT INTO asset_pauses (asset_id, reason, paused_at, paused_by) VALUES ('8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'Issuer incident', 't', 'ops')");
    const paused = await payout(new Request("https://aura.test", json({ bankAccountId, amountUsd: "25.00" })));
    expect([paused.status, (await paused.json() as { error: string }).error]).toEqual([503, "asset_paused"]);
    expect(calls.some((call) => call.url === "/transfers")).toBe(false);
  });

  it("answers a retry of the same payout with the first action, never a second Bridge payout", async () => {
    const bankAccountId = await savedBankId();
    const first = await payout(new Request("https://aura.test", json({ bankAccountId, amountUsd: "25.00" })));
    const again = await payout(new Request("https://aura.test", json({ bankAccountId, amountUsd: "25" })));
    expect([first.status, again.status]).toEqual([201, 200]);
    const [a, b] = await Promise.all([first.json(), again.json()]) as Array<{ action: { id: string } }>;
    expect(b.action.id).toBe(a.action.id);
    expect(calls.filter((call) => call.url === "/transfers")).toHaveLength(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM actions").get()).toEqual({ n: 1 });
    // A different amount is a different payout.
    payoutAmount = "26.0";
    expect((await payout(new Request("https://aura.test", json({ bankAccountId, amountUsd: "26.00" })))).status).toBe(201);
  });

  it("lets the customer try again once Bridge refuses a payout", async () => {
    const bankAccountId = await savedBankId();
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => new URL(url).pathname.endsWith("/transfers")
      ? Response.json({ message: "bad request" }, { status: 400 }) : original(url, init)));
    expect((await payout(new Request("https://aura.test", json({ bankAccountId, amountUsd: "25.00" })))).status).not.toBe(201);
    vi.stubGlobal("fetch", original);
    expect((await payout(new Request("https://aura.test", json({ bankAccountId, amountUsd: "25.00" })))).status).toBe(201);
  });

  it("applies the customer's daily limit and refuses a payout whose amount Bridge changed", async () => {
    const bankAccountId = await savedBankId();
    sqlite.exec("UPDATE security_profiles SET daily_limit_cents = 1000");
    expect(await (await payout(new Request("https://aura.test", json({ bankAccountId, amountUsd: "25.00" })))).json()).toMatchObject({ error: "daily_limit" });
    expect(calls.some((call) => call.url === "/transfers")).toBe(false);
    sqlite.exec("UPDATE security_profiles SET daily_limit_cents = NULL");
    payoutAmount = "30.0";
    expect((await payout(new Request("https://aura.test", json({ bankAccountId, amountUsd: "25.00" })))).status).toBe(503);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM actions").get()).toEqual({ n: 0 });
  });
});
