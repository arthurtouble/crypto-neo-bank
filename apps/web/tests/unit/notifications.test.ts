import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingTransfer } from "@/lib/activity/incoming";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const wallet = "0x1111111111111111111111111111111111111111";
const state = vi.hoisted(() => ({ db: null as D1Database | null, subject: "alice" }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: state.subject, sessionReference: "session" }) }));
vi.mock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => wallet }));
vi.mock("@/lib/auth/privy", () => ({ privyClient: () => { throw new Error("Privy isn't reachable in unit tests"); }, privyEmail: async () => { throw new Error("Privy isn't reachable in unit tests"); } }));
vi.mock("@/lib/activity/incoming", async (original) => ({ ...await original<object>(), readIncoming: async () => ({ transfers: [], status: "available", partial: false, observedAt: "t" }) }));

const { notify, listNotifications, markAllRead, securityNotice, receivedNotice, actionNotice } = await import("@/lib/notifications/store");
const { deliverPending } = await import("@/lib/notifications/deliver");
const { scanIncoming, watchAccount } = await import("@/lib/notifications/incoming");
const { GET: inbox } = await import("@/app/api/notifications/route");
const { POST: readAll } = await import("@/app/api/notifications/read/route");
const push = await import("@/app/api/notifications/push/route");
const { recheckOpenActions } = await import("@/lib/actions/recheck");

const now = new Date("2026-09-28T12:00:00.000Z");
type Read = NonNullable<NonNullable<Parameters<typeof scanIncoming>[1]>["read"]>;
const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

let sqlite: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  sqlite = schemaDatabase();
  db = state.db = d1(sqlite);
  state.subject = "alice";
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't')`);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Aura <notices@aura.test>");
  vi.stubEnv("APP_ORIGIN", "https://aura.test");
});
afterEach(() => { vi.unstubAllEnvs(); sqlite.close(); });

const statuses = () => sqlite.prepare("SELECT kind, email_status, push_status, delivery_attempts FROM notifications ORDER BY created_at").all();
const transfer = (id: string, receivedAt: string): IncomingTransfer => ({ id, chainId: 8453, transactionHash: `0x${id.padEnd(64, "0")}`,
  from: "0xabe0000000000000000000000000000000006b54", assetId: "base-usdc", symbol: "USDC", decimals: 6, amountRaw: "1000000", amount: "1",
  blockNumber: 1, receivedAt, status: "completed", final: false, source: "alchemy" });

/** A fake of Resend and push services that records what was sent. */
function edge(replies: { email?: number; push?: number } = {}) {
  const sent: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    const status = url.includes("resend") ? replies.email ?? 200 : replies.push ?? 201;
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { sent, fetcher, email: async () => "alice@example.com" };
}

describe("recording notices", () => {
  it("records each event once, only for a known customer, and lists newest first with an unread count", async () => {
    const lock = securityNotice("locked", "Your Aura account was locked.", "2");
    expect(await notify(db, "alice", lock, now)).toBe(true);
    expect(await notify(db, "alice", lock, now)).toBe(false);
    expect(await notify(db, "nobody", lock, now)).toBe(false);
    await notify(db, "alice", receivedNotice(transfer("t1", "2026-09-28T12:00:00.000Z")), new Date(now.getTime() + 1000));
    const list = await listNotifications(db, "alice");
    expect(list.unread).toBe(2);
    expect(list.notifications.map((item) => [item.kind, item.title])).toEqual([["received", "Received 1 USDC"], ["security", "Your account is locked"]]);
    expect(list.notifications[1]).toMatchObject({ link: "/app/settings", read: false, body: expect.stringContaining("If this wasn't you, lock your account") });
    await markAllRead(db, "alice", now);
    expect((await listNotifications(db, "alice")).unread).toBe(0);
  });

  it("words a failed action with its reason and links to the transaction", () => {
    const action = { id: "a1", kind: "transfer", chainId: 8453, failureReason: "reverted", summary: { amount: "5", symbol: "USDC", recipient: "0x2222222222222222222222222222222222222222" } };
    const notice = actionNotice(action as never, "failed");
    expect(notice).toMatchObject({ kind: "failed", dedupeKey: "action:a1:failed", link: "/app/transactions?open=a1" });
    expect(notice.title).toMatch(/didn't go through$/);
  });

  it("says Earn money went to the protocol, or came back from it, with vault names whole", () => {
    const earn = (direction: "deposit" | "withdraw", extra: Record<string, unknown> = {}) => actionNotice({ id: "e1", kind: "earn", chainId: 8453,
      summary: { protocol: "aave", direction, symbol: "USDC", decimals: 6, amount: "1", amountRaw: "1000000", ...extra } } as never, "completed");
    expect(earn("deposit")).toMatchObject({ title: "Added to Earn 1 USDC", body: "To Aave, on Base." });
    expect(earn("withdraw")).toMatchObject({ title: "1 USDC is back in your account", body: "It came out of Aave and is in your account on Base." });
    expect(earn("withdraw", { protocol: "morpho", vaultName: "Steakhouse Prime USDC" }).body).toBe("It came out of Steakhouse Prime USDC and is in your account on Base.");
    expect(earn("deposit", { protocol: "morpho", vaultName: "Steakhouse Prime USDC" }).body).toBe("To Steakhouse Prime USDC, on Base.");
  });
});

describe("security notices", () => {
  it("tells the customer about a new saved recipient, but not when they rename one", async () => {
    const { saveWalletAddress } = await import("@/lib/security/wallet-address-book");
    sqlite.exec("INSERT INTO security_profiles (subject_reference, updated_at) VALUES ('alice', 't')");
    await saveWalletAddress(db, "alice", "0x2222222222222222222222222222222222222222", "Bob", now);
    await saveWalletAddress(db, "alice", "0x2222222222222222222222222222222222222222", "Bob B", new Date(now.getTime() + 1000));
    const list = (await listNotifications(db, "alice")).notifications;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "security", title: "New saved recipient", body: expect.stringMatching(/^Bob \(0x2222…2222\) was saved as a recipient\. It can receive from /) });
  });
});

describe("delivering notices", () => {
  it("emails through Resend with an idempotency key, and skips push when the browser isn't subscribed", async () => {
    await notify(db, "alice", receivedNotice(transfer("t1", now.toISOString())), now);
    const fake = edge();
    expect(await deliverPending(db, { fetcher: fake.fetcher, email: fake.email })).toBe(1);
    expect(fake.sent).toHaveLength(1);
    const [{ url, init }] = fake.sent;
    expect(url).toBe("https://api.resend.com/emails");
    const id = (sqlite.prepare("SELECT notification_id FROM notifications").get() as { notification_id: string }).notification_id;
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test", "Idempotency-Key": id });
    expect(JSON.parse(init.body as string)).toMatchObject({ from: "Aura <notices@aura.test>", to: ["alice@example.com"], subject: "Received 1 USDC",
      text: expect.stringContaining("https://aura.test/app/transactions?open=") });
    expect(statuses()).toEqual([{ kind: "received", email_status: "sent", push_status: "skipped", delivery_attempts: 1 }]);
    // Nothing is left to send.
    expect(await deliverPending(db, { fetcher: fake.fetcher, email: fake.email })).toBe(0);
  });

  it("follows the customer's choices for transaction notices, but always sends security notices", async () => {
    sqlite.exec(`INSERT INTO user_preferences (subject_reference, value_json, updated_at) VALUES ('alice', '{"notifications":{"transactionEmail":false}}', 't')`);
    await notify(db, "alice", receivedNotice(transfer("t1", now.toISOString())), now);
    await notify(db, "alice", securityNotice("locked", "Locked.", "2"), new Date(now.getTime() + 1));
    const fake = edge();
    await deliverPending(db, { fetcher: fake.fetcher, email: fake.email });
    expect(fake.sent.map(({ init }) => JSON.parse(init.body as string).subject)).toEqual(["Your account is locked"]);
    expect(statuses()).toMatchObject([{ kind: "received", email_status: "skipped", push_status: "skipped" }, { kind: "security", email_status: "sent" }]);
  });

  it("sends a closed account only security emails, and no push", async () => {
    sqlite.exec(`UPDATE subject_profiles SET closed_at = 't'`);
    await addSubscription("https://fcm.googleapis.com/fcm/send/one");
    await notify(db, "alice", receivedNotice(transfer("t1", now.toISOString())), now);
    await notify(db, "alice", securityNotice("closed", "Closed.", "t"), new Date(now.getTime() + 1));
    const fake = edge();
    await deliverPending(db, { fetcher: fake.fetcher, email: fake.email });
    expect(fake.sent.map(({ url }) => url)).toEqual(["https://api.resend.com/emails"]);
    expect(statuses()).toMatchObject([{ email_status: "skipped", push_status: "skipped" }, { kind: "security", email_status: "sent", push_status: "skipped" }]);
  });

  it("retries a channel that failed for a temporary reason, up to five attempts, and gives up at once on a refusal", async () => {
    await notify(db, "alice", securityNotice("locked", "Locked.", "2"), now);
    const busy = edge({ email: 503 });
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await deliverPending(db, { fetcher: busy.fetcher, email: busy.email });
      expect(statuses()).toMatchObject([{ email_status: "pending", delivery_attempts: attempt }]);
    }
    await deliverPending(db, { fetcher: busy.fetcher, email: busy.email });
    expect(statuses()).toMatchObject([{ email_status: "failed", delivery_attempts: 5 }]);

    await notify(db, "alice", securityNotice("locked", "Locked.", "3"), now);
    const refused = edge({ email: 403 });
    await deliverPending(db, { fetcher: refused.fetcher, email: refused.email });
    expect(statuses()[1]).toMatchObject({ email_status: "failed", delivery_attempts: 1 });
  });

  it("skips email when the customer has no email address or email isn't configured", async () => {
    await notify(db, "alice", securityNotice("locked", "Locked.", "2"), now);
    const fake = edge();
    await deliverPending(db, { fetcher: fake.fetcher, email: async () => null });
    expect(fake.sent).toEqual([]);
    expect(statuses()).toMatchObject([{ email_status: "skipped" }]);
  });

  async function addSubscription(endpoint: string) {
    const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    const p256dh = b64(await crypto.subtle.exportKey("raw", client.publicKey));
    sqlite.prepare("INSERT INTO push_subscriptions (endpoint, subject_reference, p256dh, auth, created_at) VALUES (?, 'alice', ?, ?, 't')")
      .run(endpoint, p256dh, b64(crypto.getRandomValues(new Uint8Array(16))));
  }
  async function vapid() {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]) as CryptoKeyPair;
    vi.stubEnv("VAPID_PUBLIC_KEY", b64(await crypto.subtle.exportKey("raw", keys.publicKey)));
    vi.stubEnv("VAPID_PRIVATE_KEY", (await crypto.subtle.exportKey("jwk", keys.privateKey)).d!);
  }

  it("pushes an encrypted, VAPID-signed message to each browser, and forgets browsers that unsubscribed", async () => {
    await vapid();
    await addSubscription("https://fcm.googleapis.com/fcm/send/one");
    await addSubscription("https://fcm.googleapis.com/fcm/send/gone");
    await notify(db, "alice", securityNotice("locked", "Locked.", "2"), now);
    const sent: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(null, { status: url.endsWith("gone") ? 410 : url.includes("resend") ? 200 : 201 });
    }) as unknown as typeof fetch;
    await deliverPending(db, { fetcher, email: async () => "alice@example.com" });
    const pushes = sent.filter(({ url }) => new URL(url).hostname === "fcm.googleapis.com");
    expect(pushes).toHaveLength(2);
    const headers = new Headers(pushes[0].init.headers);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(headers.get("authorization")).toMatch(/^vapid t=.+, k=/);
    expect(headers.get("urgency")).toBe("high");
    // The payload is encrypted for the browser: nothing readable leaves Aura.
    expect(Buffer.from(pushes[0].init.body as ArrayBuffer).toString()).not.toContain("Locked");
    expect(sqlite.prepare("SELECT endpoint FROM push_subscriptions").all()).toEqual([{ endpoint: "https://fcm.googleapis.com/fcm/send/one" }]);
    expect(statuses()).toMatchObject([{ email_status: "sent", push_status: "sent" }]);
  });

  it("keeps push pending while every browser is failing, and skips it when push isn't configured", async () => {
    await addSubscription("https://fcm.googleapis.com/fcm/send/one");
    await notify(db, "alice", securityNotice("locked", "Locked.", "2"), now);
    const fake = edge({ push: 500 });
    await deliverPending(db, { fetcher: fake.fetcher, email: fake.email });
    expect(statuses()).toMatchObject([{ push_status: "skipped" }]);

    await vapid();
    await notify(db, "alice", securityNotice("locked", "Locked.", "3"), now);
    await deliverPending(db, { fetcher: fake.fetcher, email: fake.email });
    expect(statuses()[1]).toMatchObject({ push_status: "pending" });
    expect(sqlite.prepare("SELECT failures FROM push_subscriptions").get()).toEqual({ failures: 1 });
  });
});

describe("noticing money received", () => {
  it("announces only money received after the account was first watched, once, and leaves closed accounts alone", async () => {
    await watchAccount(db, "alice", wallet.toUpperCase().replace("0X", "0x"), now);
    expect(sqlite.prepare("SELECT wallet_address, watched_since FROM incoming_watches").get()).toEqual({ wallet_address: wallet, watched_since: now.toISOString() });
    const later = new Date(now.getTime() + 60_000);
    const excluded: string[][] = [];
    const read: Read = async (_wallet, options) => {
      excluded.push([...options?.exclude ?? []]);
      return { transfers: [transfer("old", "2026-09-27T00:00:00.000Z"), transfer("new", later.toISOString())], status: "available" as const, partial: false, observedAt: "t" };
    };
    expect(await scanIncoming(db, { now: later, read })).toEqual(["alice"]);
    expect((await listNotifications(db, "alice")).notifications.map((item) => item.title)).toEqual(["Received 1 USDC"]);
    // Everything it saw is kept for operators, old money included; only new money is announced.
    expect(sqlite.prepare("SELECT subject_reference, amount, symbol FROM incoming_observations ORDER BY received_at").all())
      .toEqual([{ subject_reference: "alice", amount: "1", symbol: "USDC" }, { subject_reference: "alice", amount: "1", symbol: "USDC" }]);
    // Checked 30 seconds ago at most: not again yet.
    expect(await scanIncoming(db, { now: new Date(later.getTime() + 10_000), read })).toEqual([]);
    expect(excluded).toHaveLength(1);
    // Seen again later, it doesn't notify twice.
    expect(await scanIncoming(db, { now: new Date(later.getTime() + 60_000), read })).toEqual([]);
    expect((await listNotifications(db, "alice")).notifications).toHaveLength(1);

    sqlite.exec("UPDATE subject_profiles SET closed_at = 't'");
    await scanIncoming(db, { now: new Date(later.getTime() + 120_000), read });
    expect(excluded).toHaveLength(2);
  });

  it("never announces money received before the announcement window, so a cleaned-up notice can't come back", async () => {
    sqlite.exec(`INSERT INTO incoming_watches (subject_reference, wallet_address, watched_since, last_active_at)
      VALUES ('alice', '${wallet}', '2025-01-01T00:00:00.000Z', '${now.toISOString()}')`);
    const day = 24 * 3600_000;
    const read: Read = async () => ({ transfers: [transfer("ancient", new Date(now.getTime() - 200 * day).toISOString()),
      transfer("recent", new Date(now.getTime() - 89 * day).toISOString())], status: "available", partial: false, observedAt: "t" });
    expect(await scanIncoming(db, { now, read })).toEqual(["alice"]);
    expect(sqlite.prepare("SELECT dedupe_key FROM notifications").all()).toEqual([{ dedupe_key: "received:recent" }]);
  });

  it("stops watching accounts not used for 30 days, and never watches an unknown customer", async () => {
    await watchAccount(db, "nobody", wallet, now);
    await watchAccount(db, "alice", wallet, now);
    let reads = 0;
    const read: Read = async () => { reads += 1; return { transfers: [], status: "available", partial: false, observedAt: "t" }; };
    await scanIncoming(db, { now: new Date(now.getTime() + 31 * 24 * 3600_000), read });
    expect(reads).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM incoming_watches").get()).toEqual({ n: 1 });
  });

  it("leaves out the account's own actions", async () => {
    sqlite.exec(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint, effects_json,
      counts_toward_limit, status, transaction_hash, created_at, expires_at, updated_at) VALUES ('a1', 'alice', '${wallet}', 'route', 8453, '{}',
      '[{"to":"${wallet}","value":"0","data":"0x"}]', 'fp', '[]', 0, 'confirmed', '0x${"a".repeat(64)}', 't', 't', 't')`);
    await watchAccount(db, "alice", wallet, now);
    let exclude: string[] = [];
    await scanIncoming(db, { now, read: async (_w, options) => { exclude = [...options?.exclude ?? []]; return { transfers: [], status: "available", partial: false, observedAt: "t" }; } });
    expect(exclude).toEqual([`0x${"a".repeat(64)}`]);
  });
});

describe("notices when the customer's own actions finish", () => {
  const insert = (id: string, status: string, destination: number | null = null) => sqlite.exec(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id,
    destination_chain_id, summary_json, calls_json, calls_fingerprint, effects_json, counts_toward_limit, status, transaction_hash, created_at, expires_at, updated_at)
    VALUES ('${id}', 'alice', '${wallet}', 'transfer', 8453, ${destination ?? "NULL"}, '{"amount":"5","symbol":"USDC"}',
    '[{"to":"0x2222222222222222222222222222222222222222","value":"0","data":"0x"}]', 'fp', '[]', 1, '${status}', '0x${id.repeat(64).slice(0, 64)}',
    '2026-09-28T11:00:00.000Z', '2026-09-28T13:00:00.000Z', '2026-09-28T11:00:00.000Z')`);

  it("says complete once a same-network action is in a block, not again when it's final, and says when one fails", async () => {
    insert("a", "submitted");
    insert("b", "submitted");
    const outcomes: Record<string, "settling" | "confirmed" | "failed"> = { a: "settling", b: "failed" };
    const verify = async (action: { transactionHash: string }) => {
      const result = outcomes[action.transactionHash.slice(2, 3)];
      return result === "failed" ? { status: "failed" as const, reason: "reverted" } : result === "settling" ? { status: "settling" as const, reason: "finality" } : { status: "confirmed" as const };
    };
    await recheckOpenActions(db, now, { verify });
    outcomes.a = "confirmed";
    await recheckOpenActions(db, new Date(now.getTime() + 120_000), { verify });
    expect(sqlite.prepare("SELECT status FROM actions WHERE action_id = 'a'").get()).toEqual({ status: "confirmed" });
    const kinds = sqlite.prepare("SELECT kind, dedupe_key FROM notifications ORDER BY dedupe_key").all();
    expect(kinds).toEqual([{ kind: "completed", dedupe_key: "action:a:completed" }, { kind: "failed", dedupe_key: "action:b:failed" }]);
  });

  it("waits for a move to another network to arrive", async () => {
    insert("c", "submitted", 1);
    await recheckOpenActions(db, now, { verify: async () => ({ status: "settling", reason: "bridge_pending" }) });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()).toEqual({ n: 0 });
    await recheckOpenActions(db, new Date(now.getTime() + 120_000), { verify: async () => ({ status: "confirmed" }) });
    expect(sqlite.prepare("SELECT kind FROM notifications").all()).toEqual([{ kind: "completed" }]);
  });
});

describe("notification routes", () => {
  const request = (path: string, init: RequestInit = {}) => new Request(`https://aura.test${path}`, init);

  it("lists the customer's notices, starts watching the account, and marks them read", async () => {
    await notify(db, "alice", securityNotice("locked", "Locked.", "2"), now);
    const response = await inbox(request("/api/notifications"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ unread: 1, notifications: [{ kind: "security", title: "Your account is locked", read: false }] });
    expect(sqlite.prepare("SELECT subject_reference, wallet_address FROM incoming_watches").get()).toEqual({ subject_reference: "alice", wallet_address: wallet });
    expect((await readAll(request("/api/notifications/read", { method: "POST" }))).status).toBe(200);
    expect(await (await inbox(request("/api/notifications"))).json()).toMatchObject({ unread: 0 });
  });

  it("only shows a customer their own notices", async () => {
    await notify(db, "alice", securityNotice("locked", "Locked.", "2"), now);
    state.subject = "bob";
    expect(await (await inbox(request("/api/notifications"))).json()).toMatchObject({ unread: 0, notifications: [] });
  });

  const keys = { p256dh: b64(new Uint8Array(65).fill(4)), auth: b64(new Uint8Array(16).fill(7)) };
  const put = (body: unknown) => push.PUT(request("/api/notifications/push", { method: "PUT", body: JSON.stringify(body) }));

  it("gives the push key only when the server can send push", async () => {
    expect(await (await push.GET(request("/api/notifications/push"))).json()).toMatchObject({ publicKey: null });
    vi.stubEnv("VAPID_PUBLIC_KEY", "BPublic");
    expect(await (await push.GET(request("/api/notifications/push"))).json()).toMatchObject({ publicKey: null });
    vi.stubEnv("VAPID_PRIVATE_KEY", "private");
    expect(await (await push.GET(request("/api/notifications/push"))).json()).toMatchObject({ publicKey: "BPublic" });
  });

  it("subscribes a browser to push on an HTTPS push service, and unsubscribes it", async () => {
    expect((await put({ endpoint: "https://fcm.googleapis.com/fcm/send/sub", keys })).status).toBe(200);
    expect((await put({ endpoint: "https://fcm.googleapis.com/fcm/send/sub", keys })).status).toBe(200);
    expect(sqlite.prepare("SELECT endpoint, subject_reference FROM push_subscriptions").all()).toEqual([{ endpoint: "https://fcm.googleapis.com/fcm/send/sub", subject_reference: "alice" }]);
    // Another customer can't remove it.
    state.subject = "bob";
    await push.DELETE(request("/api/notifications/push", { method: "DELETE", body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/sub" }) }));
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get()).toEqual({ n: 1 });
    state.subject = "alice";
    expect(await (await push.DELETE(request("/api/notifications/push", { method: "DELETE", body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/sub" }) }))).json())
      .toMatchObject({ subscribed: false });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get()).toEqual({ n: 0 });
  });

  it("refuses push services that aren't HTTPS, and malformed keys", async () => {
    for (const body of [{ endpoint: "http://fcm.googleapis.com/fcm/send/sub", keys }, { endpoint: "http://127.0.0.1:9/sub", keys },
      { endpoint: "https://fcm.googleapis.com/fcm/send/sub", keys: { ...keys, auth: "not base64!" } }, { endpoint: "https://fcm.googleapis.com/fcm/send/sub", keys, extra: 1 }]) {
      const response = await put(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_subscription" });
    }
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get()).toEqual({ n: 0 });
  });
});

describe("delivery limits (security review B1, B2, B9)", () => {
  const request = (path: string, init: RequestInit = {}) => new Request(`https://aura.test${path}`, init);
  const keys = { p256dh: b64(new Uint8Array(65).fill(4)), auth: b64(new Uint8Array(16).fill(7)) };
  const put = (endpoint: string) => push.PUT(request("/api/notifications/push", { method: "PUT", body: JSON.stringify({ endpoint, keys }) }));
  async function vapidKeys() {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]) as CryptoKeyPair;
    vi.stubEnv("VAPID_PUBLIC_KEY", b64(await crypto.subtle.exportKey("raw", pair.publicKey)));
    vi.stubEnv("VAPID_PRIVATE_KEY", (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!);
  }
  async function subscribe(endpoint: string) {
    const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    sqlite.prepare("INSERT INTO push_subscriptions (endpoint, subject_reference, p256dh, auth, created_at) VALUES (?, 'alice', ?, ?, 't')")
      .run(endpoint, b64(await crypto.subtle.exportKey("raw", client.publicKey)), b64(crypto.getRandomValues(new Uint8Array(16))));
  }

  it("gives up on a push service that doesn't answer in time", async () => {
    await vapidKeys();
    await subscribe("https://fcm.googleapis.com/fcm/send/slow");
    await notify(db, "alice", securityNotice("locked", "Locked.", "2"), now);
    const fetcher = (async (url: string, init: RequestInit) => {
      if (url.includes("resend")) return new Response("{}", { status: 200 });
      // A push service that never answers: only the request's own timeout ends it.
      return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    }) as unknown as typeof fetch;
    const hung = new Promise((resolve) => setTimeout(() => resolve("hung"), 2_000));
    expect(await Promise.race([deliverPending(db, { fetcher, email: async () => "alice@example.com", pushTimeoutMs: 50 }), hung])).toBe(1);
    expect(statuses()).toMatchObject([{ email_status: "sent", push_status: "pending" }]);
    expect(sqlite.prepare("SELECT failures FROM push_subscriptions").get()).toEqual({ failures: 1 });
  });

  it("keeps at most ten browsers per customer, replacing the one subscribed longest ago", async () => {
    for (let index = 0; index < 11; index += 1) {
      vi.useFakeTimers({ now: now.getTime() + index * 1000, toFake: ["Date"] });
      expect((await put(`https://fcm.googleapis.com/fcm/send/b${index}`)).status).toBe(200);
    }
    vi.useRealTimers();
    const endpoints = (sqlite.prepare("SELECT endpoint FROM push_subscriptions ORDER BY endpoint").all() as Array<{ endpoint: string }>).map((row) => row.endpoint);
    expect(endpoints).toHaveLength(10);
    expect(endpoints).not.toContain("https://fcm.googleapis.com/fcm/send/b0");
    expect(endpoints).toContain("https://fcm.googleapis.com/fcm/send/b10");
  });

  it("claims a notice before sending it, so overlapping runs send it once", async () => {
    await notify(db, "alice", securityNotice("locked", "Locked.", "2"), now);
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sent: string[] = [];
    const fetcher = (async (url: string) => { sent.push(url); await gate; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const first = deliverPending(db, { fetcher, email: async () => "alice@example.com" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = deliverPending(db, { fetcher, email: async () => "alice@example.com" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all([first, second]);
    expect(sent).toEqual(["https://api.resend.com/emails"]);
    expect(statuses()).toMatchObject([{ email_status: "sent", delivery_attempts: 1 }]);
  });

  it("stops a run when its time is up, and leaves the rest for the next run", async () => {
    for (const reference of ["1", "2", "3"]) await notify(db, "alice", securityNotice("locked", "Locked.", reference), new Date(now.getTime() + Number(reference)));
    let clock = 0;
    const fetcher = (async () => { clock += 10_000; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    expect(await deliverPending(db, { fetcher, email: async () => "alice@example.com", budgetMs: 15_000, clock: () => clock })).toBe(2);
    expect(statuses().map((row) => (row as { email_status: string }).email_status)).toEqual(["sent", "sent", "pending"]);
  });

  it("accepts only known push services", async () => {
    for (const endpoint of ["https://fcm.googleapis.com/fcm/send/a", "https://web.push.apple.com/QAbc", "https://updates.push.services.mozilla.com/wpush/v2/a",
      "https://wns2-par02p.notify.windows.com/w/?token=a"]) expect((await put(endpoint)).status, endpoint).toBe(200);
    for (const endpoint of ["https://push.example/sub", "https://fcm.googleapis.com.evil.example/x", "https://evil.example/fcm.googleapis.com",
      "https://user@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x"]) {
      const response = await put(endpoint);
      expect(response.status, endpoint).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_subscription" });
    }
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get()).toEqual({ n: 4 });
  });

  it("never moves another customer's browser to a different customer", async () => {
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('bob', 'bob', 't', 't')`);
    expect((await put("https://fcm.googleapis.com/fcm/send/shared")).status).toBe(200);
    state.subject = "bob";
    const response = await put("https://fcm.googleapis.com/fcm/send/shared");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "subscription_in_use" });
    expect(sqlite.prepare("SELECT subject_reference FROM push_subscriptions").all()).toEqual([{ subject_reference: "alice" }]);
  });

  it("links notices only to paths in the app", async () => {
    await notify(db, "alice", { ...securityNotice("locked", "Locked.", "2"), link: "@evil.example/x" }, now);
    await notify(db, "alice", { ...securityNotice("locked", "Locked.", "3"), link: "//evil.example/x" }, new Date(now.getTime() + 1));
    await notify(db, "alice", { ...securityNotice("locked", "Locked.", "4"), link: "/app/cards" }, new Date(now.getTime() + 2));
    const fake = edge();
    await deliverPending(db, { fetcher: fake.fetcher, email: fake.email });
    expect(fake.sent.map(({ init }) => JSON.parse(init.body as string).text.match(/Open in Aura: (\S+)/)[1]))
      .toEqual(["https://aura.test/app", "https://aura.test/app", "https://aura.test/app/cards"]);
  });
});
