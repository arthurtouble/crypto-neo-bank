import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { readPreferences } from "@aurel/provider-projections";
import { privyEmail } from "@/lib/auth/privy";
import { localEdgeUrl } from "@/lib/testing/local-edge";
import { renderNoticeEmail } from "./email";
import { NOTICE_TAG } from "./email-events";
import { appPath, isLocalTestPushEndpoint, isPushEndpoint, MAX_PUSH_SUBSCRIPTIONS } from "./push-endpoints";
import { notify, type Notice, type NotificationKind } from "./store";

/**
 * Deliver pending notices by email (Resend) and browser push (Web Push with
 * VAPID). Security notices are always emailed; transaction emails follow the
 * customer's choice in Settings. Push goes to each browser where the customer
 * turned it on. A closed account gets only security notices. A
 * channel that fails is retried on later runs, up to MAX_ATTEMPTS, then
 * marked failed. The in-app list never depends on delivery.
 *
 * A run claims each notice (and counts the attempt) before sending it, so
 * runs that overlap never send a notice twice; a claim lapses after
 * CLAIM_MS if its run stopped. Each push request has its own timeout, and a
 * run stops starting notices once its time budget is spent, so one slow push
 * service can't hold up delivery for everyone.
 */
const MAX_ATTEMPTS = 5;
const CLAIM_MS = 2 * 60_000;
const PUSH_TIMEOUT_MS = 5_000;
const RUN_BUDGET_MS = 25_000;
const RESEND_API = "https://api.resend.com";

type Pending = { notification_id: string; subject_reference: string; kind: NotificationKind; title: string; body: string; link: string | null;
  email_status: string; push_status: string; delivery_attempts: number; closed_at: string | null };
type Channel = "sent" | "skipped" | "failed" | "retry";
export type Deps = { fetcher?: typeof fetch; email?: (subject: string) => Promise<string | null>; pushTimeoutMs?: number; budgetMs?: number; clock?: () => number };

const appLink = (link: string | null) => `${(process.env.APP_ORIGIN ?? "").replace(/\/$/, "")}${appPath(link)}`;

async function sendEmail(notice: Pending, to: string | null, fetcher: typeof fetch): Promise<Channel> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!to || !key || !from) return "skipped";
  const { subject, text, html } = renderNoticeEmail(notice, appLink(notice.link));
  const response = await fetcher(`${localEdgeUrl("RESEND_API_URL") ?? RESEND_API}/emails`, { method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": notice.notification_id },
    body: JSON.stringify({ from, to: [to], subject, text, html, tags: [{ name: NOTICE_TAG, value: notice.notification_id }] }), signal: AbortSignal.timeout(8_000) });
  // 4xx other than rate limits won't succeed on a retry (for example an unverified recipient while Resend is in test mode).
  if (response.ok) return "sent";
  return response.status === 429 || response.status >= 500 ? "retry" : "failed";
}

async function sendPush(db: D1Database, notice: Pending, fetcher: typeof fetch, timeoutMs: number): Promise<Channel> {
  // The newest browsers only, and only on known push services.
  const rows = await db.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE subject_reference = ?
    ORDER BY created_at DESC LIMIT ${MAX_PUSH_SUBSCRIPTIONS}`).bind(notice.subject_reference)
    .all<{ endpoint: string; p256dh: string; auth: string }>();
  const endpoints = rows.results.filter((row) => isPushEndpoint(row.endpoint));
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!endpoints.length || !publicKey || !privateKey) return "skipped";
  const data = JSON.stringify({ title: notice.title, body: notice.body, link: appPath(notice.link), id: notice.notification_id });
  let delivered = false;
  for (const row of endpoints) {
    try {
      const subscription: PushSubscription = { endpoint: row.endpoint, expirationTime: null, keys: { p256dh: row.p256dh, auth: row.auth } };
      const signal = AbortSignal.timeout(timeoutMs);
      // The end-to-end tests' fake push service is plain HTTP on loopback; real push services are HTTPS and get the encrypted message.
      const response = isLocalTestPushEndpoint(row.endpoint)
        ? await fetcher(row.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: data, signal })
        : await fetcher(row.endpoint, { ...await buildPushPayload({ data, options: { ttl: 24 * 3600, urgency: notice.kind === "security" ? "high" : "normal" } },
          subscription, { subject: appLink(null), publicKey, privateKey }), signal });
      if (response.ok) { delivered = true; await db.prepare("UPDATE push_subscriptions SET failures = 0 WHERE endpoint = ?").bind(row.endpoint).run(); }
      // The browser unsubscribed or the subscription expired: forget it.
      else if (response.status === 404 || response.status === 410) await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(row.endpoint).run();
      else await db.prepare("UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?").bind(row.endpoint).run();
    } catch {
      await db.prepare("UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?").bind(row.endpoint).run();
    }
  }
  return delivered ? "sent" : "retry";
}

/** Deliver up to `limit` pending notices, for one customer or everyone. Returns how many this run handled. */
export async function deliverPending(db: D1Database, options: { subject?: string; limit?: number } & Deps = {}): Promise<number> {
  const fetcher = options.fetcher ?? fetch;
  const clock = options.clock ?? Date.now;
  const started = clock();
  const unclaimed = "(delivery_claimed_until IS NULL OR delivery_claimed_until <= ?1)";
  const rows = await db.prepare(`SELECT n.notification_id, n.subject_reference, n.kind, n.title, n.body, n.link, n.email_status, n.push_status,
      n.delivery_attempts, p.closed_at
    FROM notifications n JOIN subject_profiles p ON p.subject_reference = n.subject_reference
    WHERE (n.email_status = 'pending' OR n.push_status = 'pending') AND ${unclaimed.replace(/delivery_claimed_until/g, "n.delivery_claimed_until")}
      ${options.subject ? "AND n.subject_reference = ?2" : ""}
    ORDER BY n.created_at ASC LIMIT ${Math.min(options.limit ?? 25, 100)}`)
    .bind(new Date(started).toISOString(), ...(options.subject ? [options.subject] : [])).all<Pending>();
  let handled = 0;
  for (const notice of rows.results) {
    // Out of time: the next run picks up the rest.
    if (clock() - started >= (options.budgetMs ?? RUN_BUDGET_MS)) break;
    // Claim the notice and count the attempt before sending, so a run that overlaps this one skips it.
    const claimedAt = clock();
    const claim = await db.prepare(`UPDATE notifications SET delivery_attempts = delivery_attempts + 1, delivery_claimed_until = ?2
      WHERE notification_id = ?3 AND delivery_attempts = ?4 AND (email_status = 'pending' OR push_status = 'pending') AND ${unclaimed}`)
      .bind(new Date(claimedAt).toISOString(), new Date(claimedAt + CLAIM_MS).toISOString(), notice.notification_id, notice.delivery_attempts).run();
    if (!claim.meta.changes) continue;
    handled += 1;
    const preferences = (await readPreferences(db, notice.subject_reference)).notifications;
    const always = notice.kind === "security";
    const open = notice.closed_at === null;
    // Push goes to every browser the customer turned it on in; turning it off there is the choice.
    const wanted = { email: always || (open && preferences.transactionEmail), push: open };
    const settle = async (status: string, want: boolean, send: () => Promise<Channel>): Promise<string> => {
      if (status !== "pending") return status;
      if (!want) return "skipped";
      const result = await send().catch((): Channel => "retry");
      if (result !== "retry") return result;
      return notice.delivery_attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending";
    };
    const email = await settle(notice.email_status, wanted.email, async () => sendEmail(notice, await (options.email ?? privyEmail)(notice.subject_reference), fetcher));
    const push = await settle(notice.push_status, wanted.push, () => sendPush(db, notice, fetcher, options.pushTimeoutMs ?? PUSH_TIMEOUT_MS));
    await db.prepare("UPDATE notifications SET email_status = ?, push_status = ?, delivery_claimed_until = NULL WHERE notification_id = ?")
      .bind(email, push, notice.notification_id).run();
  }
  return handled;
}

/**
 * Deliver in the background after the response, where the Worker allows it,
 * so a request never waits on email or push. The cron picks up anything left.
 */
export function deliverSoon(db: D1Database, subject: string) {
  const work = deliverPending(db, { subject }).catch((error: unknown) =>
    console.error(JSON.stringify({ level: "warn", event: "notifications.deliver.failed", message: error instanceof Error ? error.message : "unknown" })));
  void import("cloudflare:workers").then((workers) => (workers as { waitUntil?: (promise: Promise<unknown>) => void }).waitUntil?.(work)).catch(() => undefined);
}

/**
 * Record a notice for something that already happened, and deliver it in the
 * background. The event stands whether or not its notice could be recorded,
 * so a failure here is logged, never passed on to the customer's request.
 */
export async function announce(db: D1Database, subject: string, notice: Notice, now = new Date()) {
  try {
    if (await notify(db, subject, notice, now)) deliverSoon(db, subject);
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "notifications.record.failed", dedupeKey: notice.dedupeKey, message: error instanceof Error ? error.message : "unknown" }));
  }
}
