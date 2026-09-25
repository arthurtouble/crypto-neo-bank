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
vi.mock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => wallet, WalletOwnershipError: httpErrors.WalletOwnershipError }));

const { POST: onboard } = await import("@/app/api/money/onboarding/route");
const { GET: account } = await import("@/app/api/money/account/route");
const { POST: addBank } = await import("@/app/api/money/bank-accounts/route");
const { POST: payout } = await import("@/app/api/money/payouts/route");

type Call = { url: string; method: string; body: Record<string, unknown> | null; idempotencyKey: string | null };
let sqlite: DatabaseSync;
let calls: Call[];
let activated = false;
let payoutAmount = "25.00";

const activeAccount = { id: "va_1", customer_id: "cust_1", status: "activated", source_deposit_instructions: { currency: "usd",
  payment_rails: ["ach_push"], bank_name: "Lead Bank", bank_beneficiary_name: "Alice", bank_account_number: "123456789", bank_routing_number: "876543210" } };

function bridge(url: string, init: RequestInit = {}) {
  const path = new URL(url).pathname.replace("/v0", "");
  const method = init.method ?? "GET";
  calls.push({ url: path, method, body: init.body ? JSON.parse(String(init.body)) : null,
    idempotencyKey: new Headers(init.headers).get("Idempotency-Key") });
  if (path === "/kyc_links") return Response.json({ id: "kyc_1", customer_id: "cust_1", kyc_link: "https://bridge.test/kyc", tos_link: "https://bridge.test/tos",
    kyc_status: "not_started", tos_status: "pending" });
  if (path.endsWith("/virtual_accounts") && method === "GET") return Response.json({ data: activated ? [activeAccount] : [] });
  if (path.endsWith("/virtual_accounts")) { activated = true; return Response.json(activeAccount); }
  if (path.endsWith("/external_accounts")) return Response.json({ id: "ea_1", last_4: "6789", bank_name: "Lead Bank", active: true });
  if (path === "/transfers") return Response.json({ id: "tr_1", state: "awaiting_funds", source_deposit_instructions: {
    payment_rail: "base", currency: "usdc", to_address: depositAddress, amount: payoutAmount } });
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec("UPDATE feature_flags SET enabled = 1");
  state.db = d1(sqlite);
  calls = []; activated = false; payoutAmount = "25.00";
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
    expect(calls[0]).toMatchObject({ url: "/kyc_links", method: "POST", idempotencyKey: "kyc-link:alice",
      body: { full_name: "Alice Example", email: "alice@example.com", type: "individual" } });
    expect(sqlite.prepare("SELECT external_customer_id, status, onboarding_url FROM provider_customer_links").get())
      .toEqual({ external_customer_id: "cust_1", status: "pending", onboarding_url: "https://bridge.test/kyc" });
    expect(await (await account(new Request("https://aura.test/api/money/account"))).json())
      .toMatchObject({ available: true, nextAction: { type: "continue_verification", url: "https://bridge.test/kyc" } });
  });

  it("opens the USD account into the smart wallet on the first read after Bridge approves", async () => {
    await onboard(new Request("https://aura.test", json({ fullName: "Alice Example", email: "alice@example.com" })));
    sqlite.exec("UPDATE provider_customer_links SET status = 'active'");
    const body = await (await account(new Request("https://aura.test/api/money/account"))).json() as { account: { state: string; depositInstructions: unknown } };
    expect(body.account).toMatchObject({ state: "active", depositInstructions: { accountNumber: "123456789" } });
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/virtual_accounts"))?.body)
      .toEqual({ source: { currency: "usd" }, destination: { currency: "usdc", payment_rail: "base", address: wallet } });
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
    const response = await payout(new Request("https://aura.test", json({ bankAccountId: await savedBankId(), amountUsd: "25.00" })));
    expect(response.status).toBe(201);
    const { action } = await response.json() as { action: { calls: Array<{ data: `0x${string}` }>; summary: Record<string, unknown>; usdCents: number } };
    expect(decodeFunctionData({ abi: erc20Abi, data: action.calls[0].data }).args).toEqual([depositAddress, 25_000_000n]);
    expect(action).toMatchObject({ usdCents: 2500, summary: { bankPayout: { transferId: "tr_1", lastFour: "6789" } } });
    expect(calls.find((call) => call.url === "/transfers")?.body).toMatchObject({ on_behalf_of: "cust_1", amount: "25.00",
      source: { payment_rail: "base", currency: "usdc", from_address: wallet }, destination: { payment_rail: "ach", external_account_id: "ea_1" } });
  });

  it("applies the customer's daily limit and refuses a payout whose amount Bridge changed", async () => {
    const bankAccountId = await savedBankId();
    sqlite.exec("UPDATE security_profiles SET daily_limit_cents = 1000");
    expect(await (await payout(new Request("https://aura.test", json({ bankAccountId, amountUsd: "25.00" })))).json()).toMatchObject({ error: "daily_limit" });
    expect(calls.some((call) => call.url === "/transfers")).toBe(false);
    sqlite.exec("UPDATE security_profiles SET daily_limit_cents = NULL");
    payoutAmount = "30.00";
    expect((await payout(new Request("https://aura.test", json({ bankAccountId, amountUsd: "25.00" })))).status).toBe(503);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM actions").get()).toEqual({ n: 0 });
  });
});
