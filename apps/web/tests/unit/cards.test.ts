import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
const state = vi.hoisted(() => ({ db: null as D1Database | null, mfa: true, allowance: 0n, chain: "ok" as "ok" | "down" }));
const wallet = "0x1111111111111111111111111111111111111111";
const spender = "0x5555555555555555555555555555555555555555";
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "s" }) }));
vi.mock("@/lib/auth/privy", () => ({ privyClient: () => ({}) }));
vi.mock("@/lib/auth/wallet", () => ({
  requireActionWallet: async () => wallet,
  requireActionAccount: async () => ({ address: wallet, walletId: "wallet-alice" }),
  requireMoneyMfa: async () => { if (!state.mfa) throw new httpErrors.MfaRequiredError(); },
  WalletOwnershipError: httpErrors.WalletOwnershipError
}));
// The customer's passkey unlocks the signature Privy checks; here every confirmation is valid.
vi.mock("@/lib/actions/privy-relay", async (original) => ({ ...await original<object>(), relayPersonalSign: async () => "0xsigned" }));
vi.mock("@/lib/assets/prices", async (original) => ({ ...await original<object>(), baseClient: () => ({
  readContract: async ({ functionName }: { functionName: string }) => {
    if (state.chain === "down") throw new Error("rpc down");
    return functionName === "allowance" ? state.allowance : 40_000_000n;
  } }) }));

const cards = await import("@/app/api/cards/route");
const { POST: apply } = await import("@/app/api/cards/apply/route");
const { PATCH: controls } = await import("@/app/api/cards/controls/route");
const { POST: detailsKey } = await import("@/app/api/cards/details-key/route");
const { POST: dispute } = await import("@/app/api/cards/disputes/route");
const { POST: allowance } = await import("@/app/api/cards/allowance/route");
const { freezeCardForLock, readCardActivity, readCardHistory } = await import("@/lib/cards/service");
const { StripeClient, stripeForm } = await import("@/lib/providers/stripe/client");

type Call = { path: string; method: string; form: URLSearchParams; idempotencyKey: string | null; version: string | null };
let sqlite: DatabaseSync;
let calls: Call[];
let endorsement: { status: string; cardholder: string | null };
let stripeCard: Record<string, unknown> | null;
let transactions: Array<Record<string, unknown>>;
let disputes: Array<Record<string, unknown>>;
const nowSeconds = Math.floor(Date.now() / 1000);

function fakeProviders(url: string, init: RequestInit = {}) {
  const { hostname, pathname } = new URL(url);
  const method = init.method ?? "GET";
  const form = new URLSearchParams(typeof init.body === "string" ? init.body : "");
  const headers = new Headers(init.headers);
  calls.push({ path: pathname, method, form, idempotencyKey: headers.get("Idempotency-Key"), version: headers.get("Stripe-Version") });
  if (hostname !== "api.stripe.com") {
    const path = pathname.replace("/v0", "");
    if (path === "/customers/cust_1") return Response.json({ id: "cust_1", stripe_cardholder_id: endorsement.cardholder,
      endorsements: endorsement.status === "none" ? [] : [{ name: "cards", status: endorsement.status, requirements: { issues: endorsement.status === "incomplete" ? ["id_expired"] : [] } }] });
    if (path === "/customers/cust_1/kyc_link") return Response.json({ url: "https://bridge.test/cards" });
    return new Response("not found", { status: 404 });
  }
  if (pathname === "/v1/issuing/cards" && method === "POST") {
    stripeCard = { id: "ic_1", brand: "Visa", status: "active", type: "virtual", last4: "4242", exp_month: 9, exp_year: 2030, currency: "usd",
      spending_controls: { spending_limits: [{ amount: Number(form.get("spending_controls[spending_limits][0][amount]")), interval: "daily" }] },
      wallets: { apple_pay: { eligible: true }, google_pay: { eligible: false } } };
    return Response.json(stripeCard);
  }
  if (pathname === "/v1/issuing/cards/ic_1" && stripeCard) {
    if (method === "POST") {
      if (form.get("status")) stripeCard.status = form.get("status");
      const amount = form.get("spending_controls[spending_limits][0][amount]");
      if (amount) stripeCard.spending_controls = { spending_limits: [{ amount: Number(amount), interval: "daily" }] };
    }
    return Response.json(stripeCard);
  }
  if (pathname === "/v1/issuing/authorizations") return Response.json({ data: [
    { id: "iauth_hold", amount: 1200, currency: "usd", approved: true, status: "pending", created: nowSeconds - 60, merchant_data: { name: "Cafe" } },
    { id: "iauth_declined", amount: 90_000, currency: "usd", approved: false, status: "closed", created: nowSeconds - 120, merchant_data: { name: "Shop" } },
    { id: "iauth_settled", amount: 2500, currency: "usd", approved: true, status: "closed", created: nowSeconds - 3600, merchant_data: { name: "Books" },
      crypto_transactions: [{ crypto_transaction_confirmed: { transaction_hash: `0x${"AB".repeat(32)}`, amount: "25.00" } }] }], has_more: false });
  if (pathname === "/v1/issuing/transactions") return Response.json({ data: transactions });
  if (pathname === "/v1/issuing/disputes" && method === "GET") return Response.json({ data: disputes });
  if (pathname === "/v1/issuing/disputes") {
    const created = { id: "idp_1", status: "unsubmitted", transaction: form.get("transaction"), amount: 2500, created: nowSeconds, evidence: { reason: form.get("evidence[reason]") } };
    disputes.push(created);
    return Response.json(created);
  }
  if (pathname === "/v1/issuing/disputes/idp_1/submit") { disputes[0] = { ...disputes[0], status: "submitted" }; return Response.json(disputes[0]); }
  if (pathname === "/v1/ephemeral_keys") return Response.json({ id: "ephkey_1", secret: "ek_test_secret" });
  return Response.json({ error: { message: "no such route" } }, { status: 404 });
}

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec(`UPDATE feature_flags SET enabled = 1;
    INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');
    INSERT INTO provider_customer_links (subject_reference, provider, external_customer_id, status, created_at, updated_at)
    VALUES ('alice', 'bridge', 'cust_1', 'active', 't', 't');`);
  state.db = d1(sqlite); state.mfa = true; state.allowance = 0n; state.chain = "ok";
  calls = []; endorsement = { status: "approved", cardholder: "ich_1" }; stripeCard = null; disputes = [];
  transactions = [{ id: "ipi_1", type: "capture", amount: -2500, currency: "usd", created: nowSeconds - 3600, authorization: "iauth_settled", merchant_data: { name: "Books" } }];
  vi.stubEnv("BRIDGE_API_KEY", "bridge-key");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
  vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_1");
  vi.stubEnv("BRIDGE_CARDS_SPENDER", spender);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => fakeProviders(url, init)));
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const request = (path: string, method: string, body?: unknown) => new Request(`https://aura.test${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const read = async () => await (await cards.GET(request("/api/cards", "GET"))).json() as Record<string, unknown>;
const create = () => cards.POST(request("/api/cards", "POST"));
const signature = "c2lnbmF0dXJlLW92ZXItdGhlLXByaXZ5LXJlcXVlc3Q=";
/** Send, expect the passkey question, and send again with the signed answer. */
async function confirmed(send: (confirmation?: unknown) => Promise<Response>) {
  const first = await send();
  expect(first.status).toBe(428);
  const { challengeId } = await first.json() as { challengeId: string };
  return send({ challengeId, signature });
}

describe("Stripe form encoding", () => {
  it("encodes nested objects and arrays the way Stripe reads them, and skips empty values", () => {
    expect(decodeURIComponent(stripeForm({ a: 1, b: { c: "x", d: [{ e: 2 }], f: undefined }, g: ["h"], i: null }).toString()))
      .toBe("a=1&b[c]=x&b[d][0][e]=2&g[0]=h");
  });

  it("sends the key, version, and an idempotency key, and never guesses at an error or unknown response", async () => {
    const stripe = new StripeClient("sk_test_1");
    await expect(stripe.request("/v1/nothing", (await import("zod")).z.object({}))).rejects.toMatchObject({ name: "StripeError", status: 404 });
    stripeCard = { id: "not-a-card" };
    const { getCard } = await import("@/lib/providers/stripe/issuing");
    await expect(getCard(stripe, "ic_1")).rejects.toMatchObject({ status: 502 });
  });
});

describe("getting a card", () => {
  it("is unavailable until Stripe, the card contract, and the switch are all set", async () => {
    vi.stubEnv("BRIDGE_CARDS_SPENDER", "not-an-address");
    expect(await read()).toMatchObject({ state: "unavailable" });
    vi.stubEnv("BRIDGE_CARDS_SPENDER", spender);
    sqlite.exec("UPDATE feature_flags SET enabled = 0 WHERE flag_key = 'payment_cards'");
    expect(await read()).toMatchObject({ state: "unavailable" });
    expect((await create()).status).toBe(503);
  });

  it("asks for identity verification first, then a card application with Bridge", async () => {
    sqlite.exec("UPDATE provider_customer_links SET status = 'pending'");
    expect(await read()).toMatchObject({ state: "verify_first" });
    expect(await (await apply(request("/api/cards/apply", "POST"))).json()).toMatchObject({ error: "verification_required" });
    expect(await (await create()).json()).toMatchObject({ error: "verification_required" });
    sqlite.exec("UPDATE provider_customer_links SET status = 'active'");
    endorsement = { status: "none", cardholder: null };
    expect(await read()).toMatchObject({ state: "apply", approval: "none" });
    endorsement = { status: "incomplete", cardholder: null };
    expect(await read()).toMatchObject({ state: "apply", approval: "incomplete", issues: ["id_expired"] });
    expect(await (await apply(request("/api/cards/apply", "POST"))).json()).toMatchObject({ url: "https://bridge.test/cards" });
    expect(calls.at(-1)?.path).toBe("/v0/customers/cust_1/kyc_link");
    expect(await (await create()).json()).toMatchObject({ error: "card_approval_required" });
  });

  it("creates one virtual card spending the account's USDC on Base, with a 500 USD daily limit", async () => {
    expect(await read()).toMatchObject({ state: "ready_to_create" });
    const response = await create();
    expect(response.status).toBe(201);
    const created = calls.find((call) => call.path === "/v1/issuing/cards" && call.method === "POST")!;
    expect(Object.fromEntries(created.form)).toMatchObject({ cardholder: "ich_1", type: "virtual", "crypto_wallet[chain]": "base", "crypto_wallet[currency]": "usdc",
      "crypto_wallet[type]": "standard", "crypto_wallet[address]": wallet, "spending_controls[spending_limits][0][amount]": "50000" });
    expect(created.idempotencyKey).toBe("card:alice:ich_1");
    expect(await response.json()).toMatchObject({ state: "card", card: { id: "ic_1", lastFour: "4242", status: "active", dailyLimitUsd: 500, wallets: { applePay: true, googlePay: false } },
      allowance: { status: "available", allowanceUsd: "0", balanceUsd: "40", spender }, publishableKey: "pk_test_1", walletsEnabled: true });
    expect(sqlite.prepare("SELECT provider, provider_customer_reference, status, last_four, daily_limit FROM card_account_projections").all())
      .toEqual([{ provider: "stripe", provider_customer_reference: "ich_1", status: "active", last_four: "4242", daily_limit: "500.00" }]);
    expect(sqlite.prepare("SELECT kind, title FROM notifications").all()).toEqual([{ kind: "security", title: "Your Aura card is ready" }]);
    expect(await (await create()).json()).toMatchObject({ error: "card_exists" });
  });

  it("needs a passkey and an unlocked account to create a card", async () => {
    state.mfa = false;
    expect(await (await create()).json()).toMatchObject({ error: "mfa_required" });
    state.mfa = true;
    sqlite.exec("INSERT INTO security_profiles (subject_reference, account_locked, updated_at) VALUES ('alice', 1, 't')");
    expect(await (await create()).json()).toMatchObject({ error: "account_locked" });
    expect(calls.some((call) => call.path === "/v1/issuing/cards")).toBe(false);
  });

  it("reads every card payment for Transactions, in a time window, with the Base transaction that paid it", async () => {
    expect(await readCardHistory(state.db!, "alice")).toEqual({ status: "available", partial: false, items: [] });
    await create();
    const history = await readCardHistory(state.db!, "alice", { since: new Date(1_000_000_000), until: new Date(2_000_000_000_000) });
    expect(history).toMatchObject({ status: "available", partial: false });
    expect(history.items.find((item) => item.id === "ipi_1")).toMatchObject({ transactionHash: `0x${"ab".repeat(32)}`, merchant: "Books" });
    const [url] = (fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls.findLast(([called]) => called.includes("/v1/issuing/transactions"))!;
    const query = new URL(url).searchParams;
    expect(Object.fromEntries(query)).toEqual({ card: "ic_1", limit: "100", "created[gte]": "1000000", "created[lt]": "2000000000" });
    // A customer with a card whose payments can't be read sees that, not an empty history.
    sqlite.exec("UPDATE feature_flags SET enabled = 0 WHERE flag_key = 'payment_cards'");
    expect(await readCardHistory(state.db!, "alice")).toMatchObject({ status: "unavailable" });
  });

  it("shows the allowance as unavailable when Base can't be read, never as zero", async () => {
    await create();
    state.chain = "down";
    expect(await read()).toMatchObject({ state: "card", allowance: { status: "unavailable" } });
  });

  it("lists holds, declines, and settled payments, newest first, and which can be disputed", async () => {
    await create();
    const activity = await readCardActivity(new StripeClient("sk_test_1"), "ic_1");
    expect(activity.map((item) => [item.id, item.status, item.amountUsd, item.disputable])).toEqual([
      ["iauth_hold", "pending", "12.00", false], ["iauth_declined", "declined", "900.00", false], ["ipi_1", "completed", "25.00", true]]);
    transactions[0].created = nowSeconds - 120 * 86_400;
    expect((await readCardActivity(new StripeClient("sk_test_1"), "ic_1")).at(-1)).toMatchObject({ disputable: false });
  });
});

describe("card controls", () => {
  const patch = (body: Record<string, unknown>) => (confirmation?: unknown) => controls(request("/api/cards/controls", "PATCH", confirmation ? { ...body, confirmation } : body));
  beforeEach(async () => { await create(); });

  it("freezes and lowers the limit at once, and needs a passkey to unfreeze or raise it", async () => {
    expect(await (await patch({ frozen: true })()).json()).toMatchObject({ card: { status: "frozen" } });
    expect(await (await patch({ dailyLimitUsd: 100 })()).json()).toMatchObject({ card: { dailyLimitUsd: 100 } });
    const asked = await patch({ frozen: false, dailyLimitUsd: 800 })();
    expect(await asked.json()).toMatchObject({ error: "confirmation_required", message: "Confirm with your passkey to unfreeze your card and raise your card's daily limit to 800 USD." });
    expect(stripeCard).toMatchObject({ status: "inactive" });
    expect(await (await confirmed(patch({ frozen: false, dailyLimitUsd: 800 }))).json()).toMatchObject({ card: { status: "active", dailyLimitUsd: 800 } });
    expect(sqlite.prepare("SELECT title FROM notifications ORDER BY created_at, title").all().map((row) => (row as { title: string }).title))
      .toEqual(expect.arrayContaining(["Your card is unfrozen", "Your card limit went up"]));
    expect(sqlite.prepare("SELECT status, daily_limit FROM card_account_projections").get()).toEqual({ status: "active", daily_limit: "800.00" });
  });

  it("won't unfreeze a locked account's card, and rejects changes outside the limits", async () => {
    await patch({ frozen: true })();
    sqlite.exec("INSERT INTO security_profiles (subject_reference, account_locked, updated_at) VALUES ('alice', 1, 't')");
    expect(await (await patch({ frozen: false })()).json()).toMatchObject({ error: "account_locked" });
    expect((await patch({})()).status).toBe(400);
    expect((await patch({ dailyLimitUsd: 10_001 })()).status).toBe(400);
  });

  it("freezes the card when the account is locked", async () => {
    await freezeCardForLock(state.db!, "alice");
    expect(stripeCard).toMatchObject({ status: "inactive" });
    expect(sqlite.prepare("SELECT status FROM card_account_projections").get()).toEqual({ status: "frozen" });
  });
});

describe("card details, disputes, and allowance", () => {
  it("shows card details only to the card's owner after a passkey confirmation", async () => {
    const send = (confirmation?: unknown) => detailsKey(request("/api/cards/details-key", "POST", { nonce: "ephemeral_nonce_1", ...(confirmation ? { confirmation } : {}) }));
    expect(await (await send()).json()).toMatchObject({ error: "card_not_found" });
    await create();
    const response = await confirmed(send);
    expect(await response.json()).toMatchObject({ cardId: "ic_1", ephemeralKeySecret: "ek_test_secret" });
    expect(Object.fromEntries(calls.find((call) => call.path === "/v1/ephemeral_keys")!.form)).toEqual({ issuing_card: "ic_1", nonce: "ephemeral_nonce_1" });
  });

  it("opens and submits a dispute for the customer's own settled payment, once", async () => {
    await create();
    const send = (transactionId: string) => dispute(request("/api/cards/disputes", "POST", { transactionId, reason: "fraudulent", explanation: "I did not make this payment." }));
    expect(await (await send("ipi_other")).json()).toMatchObject({ error: "transaction_not_found" });
    const opened = await send("ipi_1");
    expect(opened.status).toBe(201);
    expect(await opened.json()).toMatchObject({ dispute: { id: "idp_1", status: "submitted" } });
    expect(Object.fromEntries(calls.find((call) => call.path === "/v1/issuing/disputes" && call.method === "POST")!.form))
      .toMatchObject({ transaction: "ipi_1", "evidence[reason]": "fraudulent", "evidence[fraudulent][explanation]": "I did not make this payment." });
    transactions[0].dispute = "idp_1";
    expect(await (await send("ipi_1")).json()).toMatchObject({ error: "already_disputed" });
  });

  it("prepares a USDC approval for the card contract, not counted as spending", async () => {
    expect(await (await allowance(request("/api/cards/allowance", "POST", { amountUsd: "50" }))).json()).toMatchObject({ error: "card_not_found" });
    await create();
    expect((await allowance(request("/api/cards/allowance", "POST", { amountUsd: "0" }))).status).toBe(422);
    const response = await allowance(request("/api/cards/allowance", "POST", { amountUsd: "50" }));
    expect(response.status).toBe(201);
    const { action } = await response.json() as { action: { id: string } };
    const row = sqlite.prepare("SELECT calls_json, effects_json, counts_toward_limit FROM actions WHERE action_id = ?").get(action.id) as { calls_json: string; effects_json: string; counts_toward_limit: number };
    const [call] = JSON.parse(row.calls_json) as Array<{ to: string; data: `0x${string}` }>;
    expect(call.to).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(decodeFunctionData({ abi: erc20Abi, data: call.data })).toEqual({ functionName: "approve", args: [spender, 50_000_000n] });
    expect(JSON.parse(row.effects_json)).toEqual([{ type: "erc20_approval", token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", spender, amountRaw: "50000000" }]);
    expect(row.counts_toward_limit).toBe(0);
  });
});
