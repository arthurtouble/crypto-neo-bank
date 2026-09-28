import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const wallet = "0x1111111111111111111111111111111111111111";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
const state = vi.hoisted(() => ({ db: null as D1Database | null, email: "alice@example.com" as string | null, signedIn: true, closed: false }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async (_request: Request, options: { allowClosed?: boolean } = {}) => {
  if (!state.signedIn) throw new httpErrors.AuthenticationError();
  if (state.closed && !options.allowClosed) throw new httpErrors.AccountClosedError();
  return { subjectReference: "did:privy:alice12345678", sessionReference: "s" };
} }));
vi.mock("@/lib/auth/privy", () => ({ privyEmail: async () => state.email, privyClient: () => ({}) }));
vi.mock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => wallet }));
vi.mock("@/lib/activity/incoming", async (original) => ({ ...await original<object>(),
  readIncoming: async () => ({ transfers: [], status: "unavailable", partial: false, observedAt: "2026-09-28T12:00:00.000Z" }) }));
vi.mock("@/lib/defi/aave", async (original) => ({ ...await original<object>(), getAaveBaseActivity: async () => { throw new Error("Aave read unavailable in unit tests"); } }));

const { intercomUserToken } = await import("@/lib/support/intercom");
const { GET: messenger } = await import("@/app/api/support/messenger/route");
const { GET: finActivity } = await import("@/app/api/support/fin/activity/route");

const SECRET = "test-intercom-secret";
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>;
const verify = (token: string, secret: string) => {
  const [header, payload, signature] = token.split(".");
  return createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url") === signature;
};

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = schemaDatabase();
  state.db = d1(sqlite);
  Object.assign(state, { email: "alice@example.com", signedIn: true, closed: false });
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('did:privy:alice12345678', 'x', 't', 't')`);
});
afterEach(() => { vi.unstubAllEnvs(); sqlite.close(); });

describe("the Intercom identity token", () => {
  it("is an HS256 JWT with the user ID, the email if there is one, and an hour's expiry", async () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    const { token, expiresAt } = await intercomUserToken({ userId: "did:privy:alice12345678", email: "alice@example.com" }, SECRET, now);
    const [header, payload] = token.split(".");
    expect(decode(header)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decode(payload)).toEqual({ user_id: "did:privy:alice12345678", email: "alice@example.com", iat: 1790596800, exp: 1790600400 });
    expect(expiresAt).toBe("2026-09-28T13:00:00.000Z");
    expect(verify(token, SECRET)).toBe(true);
    expect(verify(token, "another-secret")).toBe(false);
    const withoutEmail = await intercomUserToken({ userId: "did:privy:bob", email: null }, SECRET, now);
    expect(decode(withoutEmail.token.split(".")[1])).not.toHaveProperty("email");
  });
});

describe("GET /api/support/messenger", () => {
  const get = () => messenger(new Request("https://aura.test/api/support/messenger"));

  it("says chat is off when Intercom isn't configured", async () => {
    vi.stubEnv("INTERCOM_APP_ID", "app123");
    expect(await (await get()).json()).toMatchObject({ appId: null });
  });

  it("identifies the signed-in customer with a token signed by the server, including a closed account", async () => {
    vi.stubEnv("INTERCOM_APP_ID", "app123");
    vi.stubEnv("INTERCOM_IDENTITY_SECRET", SECRET);
    state.closed = true;
    const response = await get();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json() as { appId: string; userId: string; token: string; walletAddress: string };
    expect(body).toMatchObject({ appId: "app123", userId: "did:privy:alice12345678", walletAddress: wallet });
    expect(verify(body.token, SECRET)).toBe(true);
    expect(decode(body.token.split(".")[1])).toMatchObject({ user_id: "did:privy:alice12345678", email: "alice@example.com" });
    // The secret itself never leaves the server.
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("refuses someone who isn't signed in", async () => {
    vi.stubEnv("INTERCOM_APP_ID", "app123");
    vi.stubEnv("INTERCOM_IDENTITY_SECRET", SECRET);
    state.signedIn = false;
    expect((await get()).status).toBe(401);
  });
});

describe("Fin's data connector", () => {
  const TOKEN = "f".repeat(40);
  const get = (userId: string, token?: string) => finActivity(new Request(`https://aura.test/api/support/fin/activity?user_id=${encodeURIComponent(userId)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }));

  it("is off without a configured token, and refuses a wrong one", async () => {
    expect((await get("did:privy:alice12345678", TOKEN)).status).toBe(401);
    vi.stubEnv("FIN_CONNECTOR_TOKEN", TOKEN);
    expect((await get("did:privy:alice12345678")).status).toBe(401);
    expect((await get("did:privy:alice12345678", "g".repeat(40))).status).toBe(401);
  });

  it("answers only for a known customer", async () => {
    vi.stubEnv("FIN_CONNECTOR_TOKEN", TOKEN);
    expect((await get("alice", TOKEN)).status).toBe(400);
    expect((await get("did:privy:nobody12345678", TOKEN)).status).toBe(404);
  });

  it("lists the latest transactions in plain words, and says when some history couldn't be read", async () => {
    vi.stubEnv("FIN_CONNECTOR_TOKEN", TOKEN);
    sqlite.exec(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint, effects_json,
      counts_toward_limit, status, transaction_hash, failure_reason, created_at, expires_at, updated_at) VALUES ('a1', 'did:privy:alice12345678', '${wallet}', 'transfer', 8453,
      '{"amount":"5","symbol":"USDC","recipient":"0x2222222222222222222222222222222222222222"}', '[{"to":"${wallet}","value":"0","data":"0x"}]', 'fp', '[]', 1, 'failed',
      '0x${"a".repeat(64)}', 'reverted', '2026-09-28T11:00:00.000Z', '2026-09-28T11:05:00.000Z', '2026-09-28T11:00:00.000Z')`);
    const response = await get("did:privy:alice12345678", TOKEN);
    expect(response.status).toBe(200);
    const body = await response.json() as { transactions: Array<Record<string, unknown>>; incomplete: boolean };
    expect(body.incomplete).toBe(true);
    expect(body.transactions).toEqual([expect.objectContaining({ network: "Base", status: "failed", transactionHash: `0x${"a".repeat(64)}`,
      whyItFailed: expect.any(String), amount: expect.stringContaining("USDC") })]);
  });
});
