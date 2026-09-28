import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const state = vi.hoisted(() => ({ db: null as D1Database | null, checked: [] as string[] }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/privy", () => ({ privyClient: () => ({ users: () => ({ _get: async (id: string) => ({ id }),
  getByEmailAddress: async () => { throw Object.assign(new Error("not found"), { status: 404 }); }, getByWalletAddress: async () => ({ id: "did:privy:alice" }) }) }) }));
vi.mock("@/lib/actions/check", () => ({ checkAction: async (_db: unknown, action: { id: string }) => { state.checked.push(action.id); return { ...action, status: "confirmed" }; } }));

const { resetAccessKeys, verifyAccessToken } = await import("@/lib/auth/access");
const { GET: features } = await import("@/app/api/ops/features/route");
const { GET: findAccount } = await import("@/app/api/ops/accounts/route");
const { POST: lock } = await import("@/app/api/ops/accounts/[subject]/lock/route");
const { GET: listMovement } = await import("@/app/api/ops/movement/route");
const { GET: actionDetail } = await import("@/app/api/ops/actions/[id]/route");
const { POST: checkNow } = await import("@/app/api/ops/actions/[id]/check/route");
const { GET: stats } = await import("@/app/api/ops/stats/route");

const TEAM = "https://aura.cloudflareaccess.com";
const AUD = "ops-audience-tag";
const now = Date.parse("2026-09-28T12:00:00.000Z");
let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let fetched = 0;

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
async function token(claims: Record<string, unknown> = {}, options: { keys?: CryptoKeyPair; kid?: string; alg?: string } = {}) {
  const input = `${encode({ alg: options.alg ?? "RS256", kid: options.kid ?? "key-1" })}.${encode({ aud: [AUD], iss: TEAM, email: "Ops@Aura.test", sub: "user-1",
    iat: now / 1000, nbf: now / 1000, exp: now / 1000 + 600, ...claims })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", (options.keys ?? keys).privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

beforeAll(async () => {
  const params = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as const;
  keys = await crypto.subtle.generateKey(params, true, ["sign", "verify"]) as CryptoKeyPair;
  otherKeys = await crypto.subtle.generateKey(params, true, ["sign", "verify"]) as CryptoKeyPair;
});

let sqlite: DatabaseSync;
beforeEach(async () => {
  sqlite = schemaDatabase();
  state.db = d1(sqlite);
  state.checked = [];
  fetched = 0;
  resetAccessKeys();
  vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", TEAM);
  vi.stubEnv("CF_ACCESS_AUD", AUD);
  const jwk = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "key-1" };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === `${TEAM}/cdn-cgi/access/certs`) { fetched += 1; return Response.json({ keys: [jwk] }); }
    return new Response("no", { status: 404 });
  }));
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const asOperator = async (url: string, init: RequestInit = {}) => new Request(`https://aura.test${url}`, { ...init, headers: { "Cf-Access-Jwt-Assertion": await token() } });

describe("operator sign-in through Cloudflare Access", () => {
  it("accepts a token Access signed for the ops app, and caches the keys", async () => {
    expect(await verifyAccessToken(await token(), now)).toEqual({ email: "ops@aura.test", subject: "user-1" });
    await verifyAccessToken(await token(), now);
    expect(fetched).toBe(1);
  });

  it("refuses a forged, other-app, other-team, expired, or service token", async () => {
    await expect(verifyAccessToken(await token({}, { keys: otherKeys }), now)).rejects.toMatchObject({ status: 401 });
    await expect(verifyAccessToken(await token({ aud: ["another-app"] }), now)).rejects.toMatchObject({ status: 403 });
    await expect(verifyAccessToken(await token({ iss: "https://evil.cloudflareaccess.com" }), now)).rejects.toMatchObject({ status: 403 });
    await expect(verifyAccessToken(await token({ exp: now / 1000 - 120 }), now)).rejects.toMatchObject({ status: 401 });
    await expect(verifyAccessToken(await token({ email: undefined }), now)).rejects.toMatchObject({ status: 403 });
    await expect(verifyAccessToken(await token({}, { alg: "HS256" }), now)).rejects.toMatchObject({ status: 401 });
    await expect(verifyAccessToken("not.a-token", now)).rejects.toMatchObject({ status: 401 });
  });

  it("fetches the keys again once for a key it hasn't seen, as after Access rotates them", async () => {
    await verifyAccessToken(await token(), now);
    await expect(verifyAccessToken(await token({}, { kid: "key-2" }), now)).rejects.toMatchObject({ status: 401 });
    expect(fetched).toBe(2);
  });

  it("refuses everyone when it isn't configured, or the team domain isn't https", async () => {
    vi.stubEnv("CF_ACCESS_AUD", "");
    await expect(verifyAccessToken(await token(), now)).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("CF_ACCESS_AUD", AUD);
    vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", "http://aura.cloudflareaccess.com");
    await expect(verifyAccessToken(await token(), now)).rejects.toMatchObject({ status: 403 });
  });

  it("never lets a customer session into an operator API", async () => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    expect((await features(new Request("https://aura.test/api/ops/features", { headers: { Authorization: "Bearer privy-session" } }))).status).toBe(401);
    expect((await features(await asOperator("/api/ops/features"))).status).toBe(200);
  });
});

describe("customers", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('did:privy:alice', 'did:privy:alice', '2026-09-01T00:00:00.000Z', 't');
      INSERT INTO aura_tags (tag, subject_reference, receiving_address, display_name, created_at, updated_at) VALUES ('alice', 'did:privy:alice', '0x1111111111111111111111111111111111111111', 'Alice', 't', 't');
      INSERT INTO provider_customer_links (subject_reference, provider, external_customer_id, status, kyc_status, created_at, updated_at) VALUES ('did:privy:alice', 'bridge', 'cust_1', 'active', 'approved', 't', 't');`);
  });

  it("finds a customer by Aura tag and shows their profile", async () => {
    const { customerProfile, findCustomer } = await import("@/lib/ops/customers");
    expect(await findCustomer(state.db!, "@alice")).toBe("did:privy:alice");
    expect(await findCustomer(state.db!, "nobody_here")).toBeNull();
    expect(await customerProfile(state.db!, "did:privy:alice")).toMatchObject({ auraTag: "alice", bank: { status: "active", kycStatus: "approved" }, card: null,
      controls: { accountLocked: false }, actions: { total: 0 }, intercomUserId: "did:privy:alice" });
    expect((await findAccount(await asOperator("/api/ops/accounts?q=ab"))).status).toBe(400);
  });

  it("lists every customer newest first, a page at a time, without skipping or repeating", async () => {
    const { GET: customers } = await import("@/app/api/ops/customers/route");
    // Two sign-ups in the same instant, then older ones.
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at, closed_at) VALUES
      ('did:privy:bob', 'did:privy:bob', '2026-09-10T00:00:00.000Z', 't', NULL), ('did:privy:carol', 'did:privy:carol', '2026-09-10T00:00:00.000Z', 't', '2026-09-20T00:00:00.000Z'),
      ('did:privy:dan', 'did:privy:dan', '2026-08-01T00:00:00.000Z', 't', NULL);
      INSERT INTO security_profiles (subject_reference, account_locked, updated_at) VALUES ('did:privy:bob', 1, 't');`);
    const page = async (after?: string) => await (await customers(await asOperator(`/api/ops/customers?limit=2${after ? `&after=${encodeURIComponent(after)}` : ""}`))).json() as
      { customers: Array<{ subjectReference: string; auraTag: string | null; accountLocked: boolean; closedAt: string | null; bankStatus: string | null }>; next: string | null };
    const first = await page();
    // Carol and Bob signed up in the same instant; Alice on 1 September; Dan in August.
    expect(first.customers.map((row) => row.subjectReference)).toEqual(["did:privy:carol", "did:privy:bob"]);
    expect(first.customers[0].closedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(first.customers[1].accountLocked).toBe(true);
    const second = await page(first.next!);
    expect(second.customers.map((row) => row.subjectReference)).toEqual(["did:privy:alice", "did:privy:dan"]);
    expect(second.customers[0]).toMatchObject({ auraTag: "alice", bankStatus: "active", accountLocked: false });
    expect(second.next).toBeNull();
    expect((await customers(await asOperator("/api/ops/customers?after=nonsense"))).status).toBe(400);
    expect((await customers(new Request("https://aura.test/api/ops/customers"))).status).toBe(401);
  });

  it("locks an account for the customer's protection, once, with the operator's email in the audit and a notice to the customer", async () => {
    const send = async (subject = "did:privy:alice", reason = "Customer reported a stolen phone") => lock(new Request("https://aura.test", {
      method: "POST", body: JSON.stringify({ reason }), headers: { "Cf-Access-Jwt-Assertion": await token() } }), { params: Promise.resolve({ subject: encodeURIComponent(subject) }) });
    const locked = await send();
    expect(locked.status).toBe(200);
    expect(await locked.json()).toMatchObject({ profile: { controls: { accountLocked: true } } });
    expect(sqlite.prepare("SELECT actor_reference, action, evidence_json FROM audit_events").get())
      .toEqual({ actor_reference: "ops@aura.test", action: "account.locked", evidence_json: JSON.stringify({ reason: "Customer reported a stolen phone" }) });
    expect(sqlite.prepare("SELECT kind, title FROM notifications").get()).toEqual({ kind: "security", title: "Your account is locked" });
    expect(await (await send()).json()).toMatchObject({ error: "already_locked" });
    expect((await send("did:privy:alice", "no")).status).toBe(400);
    expect((await send("alice")).status).toBe(400);
  });
});

describe("money movement", () => {
  const insert = (id: string, subject: string, status: string, created: string, extra: { kind?: string; submitted?: string; summary?: string } = {}) =>
    sqlite.exec(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint, effects_json,
      counts_toward_limit, usd_cents, status, submitted_at, created_at, expires_at, updated_at)
      VALUES ('${id}', '${subject}', '0x1111111111111111111111111111111111111111', '${extra.kind ?? "transfer"}', 8453, '${extra.summary ?? '{"symbol":"USDC","amount":"10"}'}',
      '[{"to":"0x2222222222222222222222222222222222222222","value":"0","data":"0x"}]', 'fp', '[]', 1, 1000, '${status}', ${extra.submitted ? `'${extra.submitted}'` : "NULL"}, '${created}', '${created}', '${created}');`);
  beforeEach(() => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES
      ('did:privy:alice', 'did:privy:alice', '2026-09-20T00:00:00.000Z', 't'), ('did:privy:bob', 'did:privy:bob', '2026-08-01T00:00:00.000Z', 't');`);
    insert("a1", "did:privy:alice", "confirmed", "2026-09-27T10:00:00.000Z");
    insert("a2", "did:privy:bob", "failed", "2026-09-27T11:00:00.000Z", { kind: "earn", summary: '{"direction":"deposit","symbol":"USDC","amount":"5"}' });
    insert("a3", "did:privy:alice", "submitted", "2026-09-28T11:00:00.000Z", { submitted: "2026-09-28T11:00:00.000Z" });
    insert("a4", "did:privy:bob", "prepared", "2026-09-28T11:30:00.000Z");
    insert("a5", "did:privy:bob", "submitted", "2026-09-28T11:55:00.000Z", { submitted: "2026-09-28T11:55:00.000Z" });
  });

  const ids = async (query: string) => ((await (await listMovement(await asOperator(`/api/ops/movement${query}`))).json()) as { rows: Array<{ id: string }> }).rows.map((item) => item.id);

  it("lists every customer's actions, newest first, without unsigned ones, and filters them", async () => {
    expect(await ids("")).toEqual(["a5", "a3", "a2", "a1"]);
    expect(await ids("?status=failed")).toEqual(["a2"]);
    expect(await ids("?kind=earn")).toEqual(["a2"]);
    expect(await ids(`?subject=${encodeURIComponent("did:privy:alice")}`)).toEqual(["a3", "a1"]);
    // Submitted an hour ago with no receipt is stuck; five minutes ago isn't yet.
    expect(await ids("?stuck=1")).toEqual(["a3"]);
    expect(await ids(`?before=${encodeURIComponent("2026-09-28T00:00:00.000Z")}`)).toEqual(["a2", "a1"]);
    expect((await listMovement(await asOperator("/api/ops/movement?status=nope"))).status).toBe(400);
  });

  it("merges money received from outside Aura into the feed by time, and filters it", async () => {
    sqlite.exec(`INSERT INTO incoming_observations (transfer_id, subject_reference, wallet_address, chain_id, transaction_hash, from_address, asset_id, symbol, decimals,
      amount_raw, amount, final, source, received_at, observed_at) VALUES
      ('incoming:8453:0xabc:log:0', 'did:privy:bob', '0x1111111111111111111111111111111111111111', 8453, '0xabc', '0x5555555555555555555555555555555555555555',
       '8453:usdc', 'USDC', 6, '7000000', '7', 1, 'Alchemy, Base', '2026-09-28T11:30:00.000Z', 't')`);
    expect(await ids("")).toEqual(["a5", "incoming:8453:0xabc:log:0", "a3", "a2", "a1"]);
    const body = await (await listMovement(await asOperator("/api/ops/movement?kind=received"))).json() as { rows: Array<Record<string, unknown>> };
    expect(body.rows).toEqual([expect.objectContaining({ origin: "incoming", label: "Received", amountText: "7 USDC", statusText: "Completed", subject: "did:privy:bob",
      counterparty: "0x5555555555555555555555555555555555555555", source: "Alchemy, Base" })]);
    // Status, kind, and stuck are about Aura actions, so they leave received money out.
    expect(await ids("?status=failed")).toEqual(["a2"]);
    expect(await ids("?kind=transfer")).toEqual(["a5", "a3", "a1"]);
    expect(await ids(`?subject=${encodeURIComponent("did:privy:bob")}`)).toEqual(["a5", "incoming:8453:0xabc:log:0", "a2"]);
  });

  it("shows an action's journey, and checks an open one against the chain on request", async () => {
    sqlite.exec(`INSERT INTO action_events (event_id, action_id, event_type, evidence_json, occurred_at) VALUES ('e1', 'a3', 'submitted', '{"hash":"0xabc"}', '2026-09-28T11:00:01.000Z')`);
    const params = (id: string) => ({ params: Promise.resolve({ id }) });
    const detail = await (await actionDetail(await asOperator("/api/ops/actions/a3"), params("a3"))).json() as Record<string, unknown>;
    expect(detail).toMatchObject({ action: { id: "a3", subject: "did:privy:alice", status: "submitted" }, entry: { type: "sent", status: "pending" },
      events: [{ type: "submitted", evidence: { hash: "0xabc" } }] });
    expect((await actionDetail(await asOperator("/api/ops/actions/nope"), params("nope"))).status).toBe(404);
    expect((await checkNow(await asOperator("/api/ops/actions/a3/check", { method: "POST" }), params("a3"))).status).toBe(200);
    expect(state.checked).toEqual(["a3"]);
    expect(sqlite.prepare("SELECT actor_reference, action FROM audit_events").get()).toEqual({ actor_reference: "ops@aura.test", action: "action.checked" });
    expect(await (await checkNow(await asOperator("/api/ops/actions/a1/check", { method: "POST" }), params("a1"))).json()).toMatchObject({ error: "action_not_open" });
  });

  it("shows one customer's whole account history, including money that arrived from outside Aura", async () => {
    vi.doMock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => "0x1111111111111111111111111111111111111111" }));
    vi.doMock("@/lib/activity/history", () => ({ readHistory: async (_db: unknown, subject: string, wallet: string) => ({
      observedAt: "t", sources: { aura: { status: "available", partial: false }, incoming: { status: "unavailable", partial: false } },
      entries: [{ id: "in-1", origin: "incoming", type: "received", status: "completed", createdAt: "2026-09-28T10:00:00.000Z", chainId: 8453, asset: "USDC", amount: "7",
        counterparty: `${subject}:${wallet}`, source: "Alchemy, Base" }] }) }));
    vi.resetModules();
    const { GET: history } = await import("@/app/api/ops/customers/[subject]/history/route");
    const params = (subject: string) => ({ params: Promise.resolve({ subject: encodeURIComponent(subject) }) });
    const body = await (await history(await asOperator("/api/ops/customers/x/history"), params("did:privy:alice"))).json() as Record<string, unknown>;
    expect(body).toMatchObject({ wallet: "0x1111111111111111111111111111111111111111", sources: { incoming: { status: "unavailable" } },
      entries: [{ label: "Received", amountText: "7 USDC", statusText: "Completed", counterparty: "did:privy:alice:0x1111111111111111111111111111111111111111" }] });
    expect((await history(await asOperator("/api/ops/customers/x/history"), params("alice"))).status).toBe(400);
    vi.doUnmock("@/lib/auth/wallet");
    vi.doUnmock("@/lib/activity/history");
  });

  it("counts customers, activity, volume by kind, and how far new customers get", async () => {
    sqlite.exec(`INSERT INTO provider_customer_links (subject_reference, provider, status, created_at, updated_at) VALUES ('did:privy:alice', 'bridge', 'active', 't', 't');
      INSERT INTO product_events (event_id, subject_reference, session_reference, event_name, surface, properties_json, occurred_at)
      VALUES ('p1', 'did:privy:alice', 's', 'product_viewed', '/app', '{}', '2026-09-27T09:00:00.000Z'), ('p2', 'did:privy:bob', 's', 'product_viewed', '/app', '{}', '2026-09-27T09:30:00.000Z');`);
    const body = await (await stats(await asOperator("/api/ops/stats?days=30"))).json() as import("@/lib/ops/stats").Stats;
    expect(body).toMatchObject({ days: 30, customers: { total: 2, new: 1, closed: 0 }, actions: { completed: 1, failed: 1, stuck: 1 },
      volumeByKind: [{ kind: "Sent", count: 1, volumeUsd: 10 }],
      funnel: [{ step: "Signed up", customers: 1 }, { step: "Moved money", customers: 1 }, { step: "Verified with Bridge", customers: 1 }, { step: "Got a card", customers: 0 }] });
    expect(body.daily).toHaveLength(31);
    expect(body.daily.find((day) => day.day === "2026-09-27")).toEqual({ day: "2026-09-27", signups: 0, active: 2, completed: 1, volumeUsd: 10 });
    expect((await (await stats(await asOperator("/api/ops/stats?days=5"))).json() as { days: number }).days).toBe(30);
  });
});
