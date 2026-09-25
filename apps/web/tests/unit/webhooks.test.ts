import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyProviderEvent, type ProjectionDatabase, type ProviderEventMessage } from "@aurel/provider-projections";
import { sha256Hex } from "@/lib/platform/events";
import { bridgeWebhooks } from "@/lib/providers/bridge/webhooks";
import { privyWebhooks } from "@/lib/providers/privy/webhooks";
import { rainWebhooks } from "@/lib/providers/rain/webhooks";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const state = vi.hoisted(() => ({ db: null as D1Database | null, sent: [] as unknown[] }));
vi.mock("cloudflare:workers", () => ({ env: {
  get PROJECTION_DB() { return state.db; },
  PROVIDER_EVENTS: { send: async (message: unknown) => { state.sent.push(message); } }
} }));
const { POST } = await import("@/app/api/webhooks/[provider]/route");

const now = Date.parse("2026-09-25T12:00:00.000Z");
const toBase64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64");
let bridgeKeys: CryptoKeyPair;
let bridgePem: string;

async function bridgeSignature(body: string, timestamp = now, keys = bridgeKeys) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${timestamp}.${body}`));
  return `t=${timestamp},v0=${toBase64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, digest))}`;
}

const svixSecret = `whsec_${toBase64(new TextEncoder().encode("privy-test-signing-key-32-bytes!"))}`;
async function svixHeaders(body: string, id = "msg_1", timestamp = Math.floor(now / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("privy-test-signing-key-32-bytes!"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = toBase64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  return new Headers({ "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,wrong v1,${signature}` });
}

beforeAll(async () => {
  bridgeKeys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  bridgePem = `-----BEGIN PUBLIC KEY-----\n${toBase64(await crypto.subtle.exportKey("spki", bridgeKeys.publicKey)).match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----`;
});

describe("Bridge signatures", () => {
  const body = JSON.stringify({ event_id: "wh_1" });
  const verify = async (header: string, raw = body, secret = bridgePem) =>
    bridgeWebhooks.verify({ headers: new Headers({ "x-webhook-signature": header }), rawBody: raw, secret, nowMs: now });

  it("accepts Bridge's RSA signature over the timestamp and raw body", async () => {
    expect(await verify(await bridgeSignature(body))).toBe(true);
  });

  it("rejects a changed body, an old timestamp, another key, and malformed headers", async () => {
    expect(await verify(await bridgeSignature(body), `${body} `)).toBe(false);
    expect(await verify(await bridgeSignature(body, now - 11 * 60_000))).toBe(false);
    const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    expect(await verify(await bridgeSignature(body, now, other))).toBe(false);
    expect(await verify("v0=abc")).toBe(false);
    expect(await verify(await bridgeSignature(body), body, "not a key")).toBe(false);
  });

  it("maps customer and KYC events to the customer link, and keeps other categories unprojected", () => {
    const event = (category: string, object: Record<string, unknown>) => bridgeWebhooks.normalize({ event_id: "wh_1", event_category: category,
      event_type: `${category}.updated`, event_object_id: "cust_1", event_object: object, event_created_at: "2026-09-25T11:59:00Z" }, new Headers());
    expect(event("customer", { status: "active" })).toMatchObject({ id: "bridge:wh_1", type: "provider.customer.updated", data: { status: "active" },
      subject: { kind: "provider_customer", value: "cust_1" } });
    // Bridge documents approval as "active", but its customer webhook example says "approved".
    expect(event("customer", { status: "approved" })).toMatchObject({ data: { status: "approved" } });
    expect(event("kyc_link", { customer_id: null, kyc_status: "under_review", tos_status: "approved" }))
      .toMatchObject({ type: "provider.customer.updated", data: { kycStatus: "under_review", tosStatus: "approved" },
        subject: { kind: "provider_onboarding", value: "cust_1" } });
    expect(event("transfer", { on_behalf_of: "cust_1", state: "payment_processed" }))
      .toMatchObject({ type: "bank.payout.updated", data: { transferId: "cust_1", state: "payment_processed" } });
    expect(event("virtual_account.activity", { customer_id: "cust_1" })).toMatchObject({ type: "bridge.virtual_account.activity", data: {} });
    expect(bridgeWebhooks.normalize({ event_id: "x" }, new Headers())).toBeNull();
  });
});

describe("Privy (Svix) signatures", () => {
  const body = JSON.stringify({ type: "user.created", user: { id: "did:privy:alice" } });

  it("accepts any listed valid v1 signature and uses the Svix message ID as the event ID", async () => {
    const headers = await svixHeaders(body);
    expect(await privyWebhooks.verify({ headers, rawBody: body, secret: svixSecret, nowMs: now })).toBe(true);
    expect(privyWebhooks.normalize(JSON.parse(body), headers)).toMatchObject({ id: "privy:msg_1", type: "privy.user.created",
      subject: { kind: "subject", value: "did:privy:alice" } });
  });

  it("rejects a changed body, another message ID, and stale timestamps", async () => {
    expect(await privyWebhooks.verify({ headers: await svixHeaders(body), rawBody: `${body} `, secret: svixSecret, nowMs: now })).toBe(false);
    const swapped = await svixHeaders(body);
    swapped.set("svix-id", "msg_2");
    expect(await privyWebhooks.verify({ headers: swapped, rawBody: body, secret: svixSecret, nowMs: now })).toBe(false);
    expect(await privyWebhooks.verify({ headers: await svixHeaders(body, "msg_1", Math.floor(now / 1000) - 600), rawBody: body, secret: svixSecret, nowMs: now })).toBe(false);
  });
});

describe("Rain", () => {
  it("rejects every delivery until its signing scheme is implemented", async () => {
    expect(await rainWebhooks.verify({ headers: new Headers({ signature: "anything" }), rawBody: "{}", secret: "set", nowMs: now })).toBe(false);
  });
});

describe("POST /api/webhooks/:provider", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => {
    sqlite = schemaDatabase();
    state.db = d1(sqlite);
    state.sent = [];
    vi.useFakeTimers({ now, toFake: ["Date"] });
    vi.stubEnv("BRIDGE_WEBHOOK_PUBLIC_KEY", bridgePem);
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');
      INSERT INTO provider_customer_links (subject_reference, provider, external_customer_id, status, created_at, updated_at)
      VALUES ('alice', 'bridge', 'cust_1', 'pending', 't', 't');`);
  });
  afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.unstubAllEnvs(); });

  const payload = JSON.stringify({ event_id: "wh_1", event_category: "customer", event_type: "customer.updated", event_object_id: "cust_1",
    event_object: { id: "cust_1", status: "active" }, event_created_at: "2026-09-25T11:59:00.000Z" });
  const post = async (provider: string, body = payload, signature?: string) => POST(new Request(`https://aura.test/api/webhooks/${provider}`, {
    method: "POST", body, headers: { "x-webhook-signature": signature ?? await bridgeSignature(body) } }), { params: Promise.resolve({ provider }) });

  it("records a verified event once, for the customer Bridge refers to, and queues it", async () => {
    expect((await post("bridge")).status).toBe(202);
    expect((await post("bridge")).status).toBe(200);
    expect(sqlite.prepare("SELECT event_id, provider, subject_reference, processing_status FROM webhook_receipts").all())
      .toEqual([{ event_id: "bridge:wh_1", provider: "bridge", subject_reference: "alice", processing_status: "enqueued" }]);
    const message = state.sent[0] as ProviderEventMessage;
    expect(state.sent).toHaveLength(1);
    expect(message).toMatchObject({ event: { provider: "bridge", type: "provider.customer.updated", subjectReference: "alice" }, payloadSha256: await sha256Hex(payload) });

    expect(await applyProviderEvent(state.db as unknown as ProjectionDatabase, message.event)).toMatchObject({ status: "applied" });
    expect(sqlite.prepare("SELECT status, observed_at FROM provider_customer_links").get()).toEqual({ status: "active", observed_at: "2026-09-25T11:59:00.000Z" });
    expect(await applyProviderEvent(state.db as unknown as ProjectionDatabase, { ...message.event, createdAt: "2026-09-25T11:00:00.000Z", data: { status: "rejected" } }))
      .toMatchObject({ status: "stale" });
  });

  it("rejects unknown providers, unconnected providers, and bad signatures without recording anything", async () => {
    expect((await post("stripe")).status).toBe(404);
    expect((await post("privy")).status).toBe(503);
    expect((await post("bridge", payload, "t=1,v0=abc")).status).toBe(401);
    vi.stubEnv("RAIN_WEBHOOK_SECRET", "set");
    expect((await post("rain")).status).toBe(401);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM webhook_receipts").get()).toEqual({ n: 0 });
    expect(state.sent).toEqual([]);
  });
});

describe("Bridge payout state", () => {
  it("appends each payout state to the funding action once, and ignores unknown transfers", async () => {
    const sqlite = schemaDatabase();
    const db = d1(sqlite) as unknown as ProjectionDatabase;
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');
      INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint, effects_json,
        counts_toward_limit, created_at, expires_at, updated_at)
      VALUES ('a1', 'alice', '0x1111111111111111111111111111111111111111', 'transfer', 8453, '{"bankPayout":{"transferId":"tr_1"}}',
        '[{"to":"0x2222222222222222222222222222222222222222","value":"0","data":"0x"}]', 'fp', '[]', 1, 't', 't', 't');`);
    const event = (transferId: string, state: string) => applyProviderEvent(db, { id: `bridge:${state}`, provider: "bridge", type: "bank.payout.updated",
      subjectReference: "alice", providerObjectId: transferId, createdAt: "2026-09-25T12:00:00.000Z", data: { transferId, state } });
    expect(await event("tr_1", "payment_submitted")).toMatchObject({ status: "applied" });
    await event("tr_1", "payment_submitted");
    await event("tr_1", "payment_processed");
    expect(await event("tr_2", "payment_processed")).toMatchObject({ status: "ignored" });
    expect(sqlite.prepare("SELECT json_extract(evidence_json, '$.state') AS state FROM action_events ORDER BY rowid").all())
      .toEqual([{ state: "payment_submitted" }, { state: "payment_processed" }]);
    sqlite.close();
  });
});
