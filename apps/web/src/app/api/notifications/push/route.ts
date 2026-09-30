import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route, readJsonBody } from "@/lib/http/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { localEdgeUrl } from "@/lib/testing/local-edge";

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).min(16).max(200);
// Push services are HTTPS. The end-to-end tests' fake one is plain HTTP on loopback.
const endpoint = z.string().url().max(1000).refine((value) => value.startsWith("https://")
  || (localEdgeUrl("PRIVY_API_URL") !== null && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(value)));
const subscribeSchema = z.strictObject({ endpoint, keys: z.strictObject({ p256dh: base64url, auth: base64url }) });

/** The key browsers need to subscribe, and whether this server can send push at all. */
export const GET = route("notifications.push.get", { unavailable: "push_unavailable" }, async (request, { traceId }) => {
  await requireVerifiedSubject(request);
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? null;
  return Response.json({ publicKey: publicKey && process.env.VAPID_PRIVATE_KEY ? publicKey : null, traceId });
});

/** Turn on push notifications in this browser. */
export const PUT = route("notifications.push.put", { unavailable: "push_unavailable", invalid: "invalid_subscription" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "push_subscribe", subject: subject.subjectReference, limit: 20, windowSeconds: 3600 });
  const input = subscribeSchema.parse(await readJsonBody(request));
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  await env.PROJECTION_DB.prepare(`INSERT INTO push_subscriptions (endpoint, subject_reference, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET subject_reference = excluded.subject_reference, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0`)
    .bind(input.endpoint, subject.subjectReference, input.keys.p256dh, input.keys.auth, new Date().toISOString()).run();
  return Response.json({ subscribed: true, traceId });
});

/** Turn them off in this browser. */
export const DELETE = route("notifications.push.delete", { unavailable: "push_unavailable", invalid: "invalid_subscription" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const input = z.strictObject({ endpoint }).parse(await readJsonBody(request));
  await env.PROJECTION_DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND subject_reference = ?").bind(input.endpoint, subject.subjectReference).run();
  return Response.json({ subscribed: false, traceId });
});
