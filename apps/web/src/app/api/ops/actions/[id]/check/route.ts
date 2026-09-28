import { env } from "cloudflare:workers";
import { checkAction } from "@/lib/actions/check";
import { requireOperator } from "@/lib/auth/access";
import { expireIfStale, getActionForOperator, listActionEvents } from "@/lib/actions/store";
import { errorResponse, route } from "@/lib/http/route";
import { actionView } from "../../../../actions/view";

/** Check an open action against the chain now, the same way the customer's screen and the cron do. */
export const POST = route("ops.actions.id.check", { unavailable: "action_check_unavailable" }, async (request, context, { params }: { params: Promise<{ id: string }> }) => {
  const operator = await requireOperator(request);
  const now = new Date();
  let action = await getActionForOperator(env.PROJECTION_DB, (await params).id);
  if (!action) return errorResponse(404, "action_not_found", context);
  if (action.status !== "submitted" && action.status !== "settling") return errorResponse(409, "action_not_open", context, { message: "Only an open action can be checked." });
  action = await checkAction(env.PROJECTION_DB, await expireIfStale(env.PROJECTION_DB, action, now), now);
  await env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
    VALUES (?, ?, 'operator', ?, 'action.checked', 'action', ?, ?, ?)`)
    .bind(crypto.randomUUID(), action.subject, operator.email, action.id, JSON.stringify({ status: action.status }), now.toISOString()).run();
  return Response.json({ action: actionView(action), events: await listActionEvents(env.PROJECTION_DB, action.id), traceId: context.traceId });
});
