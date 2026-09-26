import { env } from "cloudflare:workers";
import { checkAction } from "@/lib/actions/check";
import { expireIfStale, getAction, listActionEvents } from "@/lib/actions/store";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { errorResponse, route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { actionView } from "../view";

const RECHECK_MS = 5_000;

/** An action's status. Submitted actions are verified against the chain on read, at most every few seconds. */
export const GET = route("actions.get", { unavailable: "action_unavailable" }, async (request, context, { params }: { params: Promise<{ id: string }> }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "action_status", subject: subject.subjectReference, limit: 60, windowSeconds: 60 });
  const now = new Date();
  let action = await getAction(env.PROJECTION_DB, subject.subjectReference, (await params).id);
  if (!action) return errorResponse(404, "action_not_found", context);
  action = await expireIfStale(env.PROJECTION_DB, action, now);
  const open = action.status === "submitted" || action.status === "settling";
  const due = !action.checkedAt || now.getTime() - Date.parse(action.checkedAt) >= RECHECK_MS;
  if (open && due) action = await checkAction(env.PROJECTION_DB, action, now);
  return Response.json({ action: actionView(action), events: await listActionEvents(env.PROJECTION_DB, action.id), traceId: context.traceId });
});
