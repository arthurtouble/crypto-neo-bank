import { env } from "cloudflare:workers";
import { actionRequest } from "@/lib/actions/relay-request";
import { expireIfStale, getAction, loadControls } from "@/lib/actions/store";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionAccount } from "@/lib/auth/wallet";
import { errorResponse, route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/** The exact Privy request the customer signs to send a prepared action. */
export const POST = route("actions.authorize", { unavailable: "authorization_unavailable" },
  async (request, context, { params }: { params: Promise<{ id: string }> }) => {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "action_authorize", subject: subject.subjectReference, limit: 30, windowSeconds: 60 });
    const found = await getAction(env.PROJECTION_DB, subject.subjectReference, (await params).id);
    if (!found) return errorResponse(404, "action_not_found", context);
    const action = await expireIfStale(env.PROJECTION_DB, found, new Date());
    // A lock also stops actions prepared before it.
    if ((await loadControls(env.PROJECTION_DB, subject.subjectReference, null, new Date())).accountLocked) {
      return errorResponse(409, "account_locked", context, { message: "Your account is locked. Unlock it in Settings to continue." });
    }
    const signable = actionRequest(action, await requireActionAccount(subject.subjectReference));
    if (!signable) return errorResponse(409, "not_signable", context, { message: "This action can't be signed any more. Start again." });
    return Response.json({ request: signable, traceId: context.traceId });
  });
