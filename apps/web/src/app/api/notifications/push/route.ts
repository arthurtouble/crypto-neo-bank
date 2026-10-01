import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { HttpError } from "@/lib/http/errors";
import { route, readJsonBody } from "@/lib/http/route";
import { isPushEndpoint, MAX_PUSH_SUBSCRIPTIONS } from "@/lib/notifications/push-endpoints";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).min(16).max(200);
// Known push services over HTTPS only (lib/notifications/push-endpoints.ts). The end-to-end tests' fake one is plain HTTP on loopback.
const endpoint = z.string().url().max(1000).refine(isPushEndpoint);
const subscribeSchema = z.strictObject({ endpoint, keys: z.strictObject({ p256dh: base64url, auth: base64url }) });

/** The key browsers need to subscribe, and whether this server can send push at all. */
export const GET = route("notifications.push.get", { unavailable: "push_unavailable" }, async (request, { traceId }) => {
  await requireVerifiedSubject(request);
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? null;
  return Response.json({ publicKey: publicKey && process.env.VAPID_PRIVATE_KEY ? publicKey : null, traceId });
});

/**
 * Turn on push notifications in this browser. A browser's subscription
 * belongs to the customer who turned it on: another customer gets a 409 and
 * the browser subscribes again for a fresh address. A customer keeps at most
 * MAX_PUSH_SUBSCRIPTIONS browsers; a new one replaces the one subscribed longest ago.
 */
export const PUT = route("notifications.push.put", { unavailable: "push_unavailable", invalid: "invalid_subscription" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "push_subscribe", subject: subject.subjectReference, limit: 20, windowSeconds: 3600 });
  const input = subscribeSchema.parse(await readJsonBody(request));
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const [saved] = await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare(`INSERT INTO push_subscriptions (endpoint, subject_reference, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at, failures = 0
      WHERE push_subscriptions.subject_reference = excluded.subject_reference`)
      .bind(input.endpoint, subject.subjectReference, input.keys.p256dh, input.keys.auth, new Date().toISOString()),
    env.PROJECTION_DB.prepare(`DELETE FROM push_subscriptions WHERE subject_reference = ?1 AND endpoint NOT IN
      (SELECT endpoint FROM push_subscriptions WHERE subject_reference = ?1 ORDER BY created_at DESC, endpoint LIMIT ${MAX_PUSH_SUBSCRIPTIONS})`)
      .bind(subject.subjectReference)
  ]);
  if (!saved.meta.changes) throw new HttpError(409, "subscription_in_use", "This browser's notifications belong to another Aura account. Subscribe again for a new one.");
  return Response.json({ subscribed: true, traceId });
});

/** Turn them off in this browser. */
export const DELETE = route("notifications.push.delete", { unavailable: "push_unavailable", invalid: "invalid_subscription" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const input = z.strictObject({ endpoint }).parse(await readJsonBody(request));
  await env.PROJECTION_DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND subject_reference = ?").bind(input.endpoint, subject.subjectReference).run();
  return Response.json({ subscribed: false, traceId });
});
