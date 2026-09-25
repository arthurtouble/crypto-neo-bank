import { env } from "cloudflare:workers";
import { applyVerification, expireIfStale, getAction } from "@/lib/actions/store";
import { verifyAction } from "@/lib/actions/verify";
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
  if (open && due && action.transactionHash) {
    const result = await verifyAction({ chainId: action.chainId, walletAddress: action.wallet, calls: action.calls,
      effects: action.effects, transactionHash: action.transactionHash });
    action = await applyVerification(env.PROJECTION_DB, action, result, now);
  }
  return Response.json({ action: actionView(action), traceId: context.traceId });
});
