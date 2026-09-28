import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";
import { markAllRead } from "@/lib/notifications/store";

/** Mark every notice as read, when the customer opens the list. */
export const POST = route("notifications.read", { unavailable: "notifications_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await markAllRead(env.PROJECTION_DB, subject.subjectReference);
  return Response.json({ ok: true, traceId });
});
