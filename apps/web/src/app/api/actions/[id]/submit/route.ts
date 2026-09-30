import { env } from "cloudflare:workers";
import { z } from "zod";
import { relaySendCalls } from "@/lib/actions/privy-relay";
import { actionRequest } from "@/lib/actions/relay-request";
import { requireUnlocked } from "@/lib/actions/controls";
import { requireAllowed, storedActionGates } from "@/lib/actions/prepare";
import { expireIfStale, getAction, recordRelay, recordSubmission } from "@/lib/actions/store";
import { privyClient } from "@/lib/auth/privy";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireMoneyAccount } from "@/lib/auth/wallet";
import { errorResponse, route, readJsonBody } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { actionView } from "../../view";

const schema = z.union([
  // The customer's authorization signature over the action's Privy request; Aura relays it with gas paid.
  z.strictObject({ signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(40).max(400) }),
  // A hash reported by a wallet that sent the calls itself.
  z.strictObject({ transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/) })
]);

/** Send or record a prepared action. The chain, not this request, decides the outcome. */
export const POST = route("actions.submit", { invalid: "invalid_submission", unavailable: "submission_unavailable" },
  async (request, context, { params }: { params: Promise<{ id: string }> }) => {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "action_submit", subject: subject.subjectReference, limit: 30, windowSeconds: 60 });
    const input = schema.parse(await readJsonBody(request));
    const found = await getAction(env.PROJECTION_DB, subject.subjectReference, (await params).id);
    if (!found) return errorResponse(404, "action_not_found", context);
    const now = new Date();

    if ("signature" in input) {
      const account = await requireMoneyAccount(subject.subjectReference);
      // A lock also stops actions prepared before it.
      await requireUnlocked(env.PROJECTION_DB, subject.subjectReference, now);
      const action = await expireIfStale(env.PROJECTION_DB, found, now);
      // A switch turned off or an asset paused after the action was prepared stops it too.
      const gates = storedActionGates(action);
      await requireAllowed(env.PROJECTION_DB, gates.features, gates.assetId);
      const signable = actionRequest(action, account);
      if (!signable) return errorResponse(409, "not_submittable", context, { message: "This action can't be sent any more. Start again." });
      let reference: string;
      try { reference = await relaySendCalls(privyClient(), account.walletId, signable, input.signature); }
      catch (error) {
        const status = (error as { status?: unknown }).status;
        // Privy refused the request itself, so nothing was sent.
        if (typeof status === "number" && status >= 400 && status < 500) {
          return errorResponse(422, "relay_rejected", context, { message: "Your wallet provider didn't accept this. Nothing was sent." });
        }
        // It may have been sent. Resubmitting this action is safe: Privy treats the same request key as the same request.
        return errorResponse(502, "relay_unconfirmed", context, { message: "We couldn't confirm it was sent. Check Transactions before you try again." });
      }
      await recordRelay(env.PROJECTION_DB, action, reference, now);
      const current = await getAction(env.PROJECTION_DB, subject.subjectReference, action.id);
      return Response.json({ action: actionView(current!), traceId: context.traceId }, { status: 202 });
    }

    const result = await recordSubmission(env.PROJECTION_DB, found, input.transactionHash, now);
    if (result === "hash_in_use") return errorResponse(409, "hash_in_use", context, { message: "This transaction is already linked to another action." });
    if (result === "not_submittable") return errorResponse(409, "not_submittable", context, { message: "This action already has a different transaction." });
    const current = await getAction(env.PROJECTION_DB, subject.subjectReference, found.id);
    return Response.json({ action: actionView(current!), traceId: context.traceId }, { status: result === "submitted" ? 202 : 200 });
  });
