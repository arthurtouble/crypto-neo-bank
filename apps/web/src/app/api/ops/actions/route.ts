import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOperator } from "@/lib/auth/access";
import { listActionsForOperator } from "@/lib/actions/store";
import { actionEntry } from "@/lib/activity/entries";
import { route } from "@/lib/http/route";

const querySchema = z.object({
  status: z.enum(["submitted", "settling", "confirmed", "failed", "expired"]).optional(),
  kind: z.enum(["transfer", "earn", "route"]).optional(),
  subject: z.string().startsWith("did:privy:").max(120).optional(),
  stuck: z.enum(["1"]).optional(),
  before: z.iso.datetime().optional()
});

/** Every customer's actions, newest first, 50 at a time, filtered by status, kind, customer, or stuck. */
export const GET = route("ops.actions.get", { unavailable: "actions_unavailable", invalid: "invalid_filter" }, async (request, { traceId }) => {
  await requireOperator(request);
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const actions = await listActionsForOperator(env.PROJECTION_DB, { ...query, stuck: query.stuck === "1", limit: 50 });
  return Response.json({
    actions: actions.map((action) => ({ ...actionEntry(action), subject: action.subject, kind: action.kind, actionStatus: action.status, submittedAt: action.submittedAt })),
    next: actions.length === 50 ? actions.at(-1)!.createdAt : null, traceId
  }, { headers: { "Cache-Control": "no-store" } });
});
