import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { deliverSoon } from "@/lib/notifications/deliver";
import { scanIncoming, watchAccount } from "@/lib/notifications/incoming";
import { listNotifications } from "@/lib/notifications/store";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/**
 * The customer's notices, newest first, with how many are unread. The app
 * polls this; each call also checks the account for money received (at most
 * every 30 seconds), so a deposit shows up while the customer is in the app.
 */
export const GET = route("notifications.get", { unavailable: "notifications_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "notifications_read", subject: subject.subjectReference, limit: 240, windowSeconds: 3600 });
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  await watchAccount(env.PROJECTION_DB, subject.subjectReference, await requireActionWallet(subject.subjectReference));
  try {
    if ((await scanIncoming(env.PROJECTION_DB, { subject: subject.subjectReference })).length) deliverSoon(env.PROJECTION_DB, subject.subjectReference);
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "notifications.incoming.failed", message: error instanceof Error ? error.message : "unknown" }));
  }
  return Response.json({ ...await listNotifications(env.PROJECTION_DB, subject.subjectReference), traceId }, { headers: { "Cache-Control": "no-store" } });
});
