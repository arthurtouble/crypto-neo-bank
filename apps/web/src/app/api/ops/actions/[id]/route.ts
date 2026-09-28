import { env } from "cloudflare:workers";
import { requireOperator } from "@/lib/auth/access";
import { getActionForOperator, listActionEvents } from "@/lib/actions/store";
import { actionEntry, entryAmount, entryLabel, statusLabel } from "@/lib/activity/entries";
import { errorResponse, route } from "@/lib/http/route";
import { actionView } from "../../../actions/view";

/** One action's journey: what was prepared, each recorded event, and where it stands. Read only; it doesn't re-check the chain. */
export const GET = route("ops.actions.id.get", { unavailable: "action_unavailable" }, async (request, context, { params }: { params: Promise<{ id: string }> }) => {
  await requireOperator(request);
  const action = await getActionForOperator(env.PROJECTION_DB, (await params).id);
  if (!action) return errorResponse(404, "action_not_found", context);
  return Response.json({ action: { ...actionView(action), subject: action.subject, wallet: action.wallet, checkedAt: action.checkedAt, bankState: action.bankState },
    entry: (() => { const entry = actionEntry(action); return { ...entry, label: entryLabel(entry.type), amountText: entryAmount(entry) ?? null, statusText: statusLabel(entry.status) }; })(), events: await listActionEvents(env.PROJECTION_DB, action.id), traceId: context.traceId }, { headers: { "Cache-Control": "no-store" } });
});
