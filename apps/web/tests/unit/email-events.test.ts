import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const state = vi.hoisted(() => ({ db: null as D1Database | null }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
const { POST } = await import("@/app/api/webhooks/resend/route");
const { notify, securityNotice } = await import("@/lib/notifications/store");
const { deliverPending } = await import("@/lib/notifications/deliver");

const signingKey = "resend-test-signing-key-32bytes!";
const secret = `whsec_${Buffer.from(signingKey).toString("base64")}`;
async function signed(body: string, timestamp = Math.floor(Date.now() / 1000), key = signingKey) {
  const hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(`msg_1.${timestamp}.${body}`))).toString("base64");
  return new Request("https://aura.test/api/webhooks/resend", { method: "POST", body,
    headers: { "svix-id": "msg_1", "svix-timestamp": String(timestamp), "svix-signature": `v1,${signature}` } });
}
const report = (type: string, notificationId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type, created_at: "2026-09-30T18:00:00Z", data: { email_id: "re_1", to: ["someone@example.com"], tags: { notification: notificationId }, ...extra } });

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = schemaDatabase();
  state.db = d1(sqlite);
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't')`);
  vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Aura <notices@aura.test>");
  vi.stubEnv("APP_ORIGIN", "https://aura.test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); sqlite.close(); });

/** A security notice, emailed through a fake Resend; returns its ID and what was sent. */
async function sentNotice() {
  await notify(state.db!, "alice", securityNotice("locked", "account", "Your account is locked."), new Date());
  const sent: { body: Record<string, unknown> }[] = [];
  await deliverPending(state.db!, { email: async () => "alice@example.com",
    fetcher: (async (_url: string, init: RequestInit) => { sent.push({ body: JSON.parse(String(init.body)) }); return new Response("{}", { status: 200 }); }) as typeof fetch });
  const { notification_id: id } = sqlite.prepare("SELECT notification_id FROM notifications").get() as { notification_id: string };
  return { id, sent };
}
const emailStatus = () => (sqlite.prepare("SELECT email_status FROM notifications").get() as { email_status: string }).email_status;

describe("Resend delivery reports", () => {
  it("tags each email with its notice, so a report can find it", async () => {
    const { id, sent } = await sentNotice();
    expect(sent[0].body.tags).toEqual([{ name: "notification", value: id }]);
    expect(emailStatus()).toBe("sent");
  });

  it("marks a bounced email failed, and logs the bounce type without the address", async () => {
    const { id } = await sentNotice();
    const response = await POST(await signed(report("email.bounced", id, { bounce: { type: "Permanent", subType: "Suppressed", message: "someone@example.com rejected" } })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "bounced" });
    expect(emailStatus()).toBe("failed");
    const logged = String(vi.mocked(console.warn).mock.calls.at(-1)?.[0]);
    expect(JSON.parse(logged)).toMatchObject({ event: "notifications.email.bounced", notificationId: id, bounceType: "Permanent", bounceSubType: "Suppressed" });
    expect(logged).not.toContain("example.com");
  });

  it("leaves the status alone for deliveries, complaints, unknown notices, and emails it never sent", async () => {
    const { id } = await sentNotice();
    for (const type of ["email.delivered", "email.complained", "email.opened"]) await POST(await signed(report(type, id)));
    expect(emailStatus()).toBe("sent");
    expect(await (await POST(await signed(report("email.bounced", "00000000-0000-4000-8000-000000000000")))).json()).toMatchObject({ outcome: "bounced" });
    expect(emailStatus()).toBe("sent");
    sqlite.exec("UPDATE notifications SET email_status = 'skipped'");
    await POST(await signed(report("email.bounced", id)));
    expect(emailStatus()).toBe("skipped");
  });

  it("accepts Resend's tag list form too, and ignores reports without a notice tag", async () => {
    const { id } = await sentNotice();
    const listForm = JSON.stringify({ type: "email.bounced", data: { email_id: "re_1", tags: [{ name: "notification", value: id }] } });
    expect(await (await POST(await signed(listForm))).json()).toMatchObject({ outcome: "bounced" });
    expect(await (await POST(await signed(JSON.stringify({ type: "email.bounced", data: { email_id: "re_2" } })))).json()).toMatchObject({ outcome: "ignored" });
  });

  it("refuses unsigned, stale, or wrongly signed reports, and anything when not connected", async () => {
    const { id } = await sentNotice();
    const body = report("email.bounced", id);
    expect((await POST(new Request("https://aura.test/api/webhooks/resend", { method: "POST", body }))).status).toBe(401);
    expect((await POST(await signed(body, Math.floor(Date.now() / 1000) - 3600))).status).toBe(401);
    expect((await POST(await signed(body, undefined, "another-key-of-thirty-two-bytes!"))).status).toBe(401);
    expect(emailStatus()).toBe("sent");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    expect((await POST(await signed(body))).status).toBe(503);
  });
});
