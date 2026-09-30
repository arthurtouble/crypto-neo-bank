import { env } from "cloudflare:workers";
import { actionInputSchema, prepareAction } from "@/lib/actions/prepare";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireMoneyAccount } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { actionView } from "./view";

/** Prepare an action for the customer's smart wallet to sign. */
export const POST = route("actions.prepare", { invalid: "invalid_action", unavailable: "action_unavailable",
  unavailableMessage: "This action couldn't be prepared. Try again." }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "actions", subject: subject.subjectReference, limit: 30, windowSeconds: 60 });
  const input = actionInputSchema.parse(await request.json());
  const { address: wallet } = await requireMoneyAccount(subject.subjectReference);
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const prepared = await prepareAction(env.PROJECTION_DB, subject.subjectReference, wallet, input);
  if (!prepared.ok) return Response.json({ error: prepared.block.code, message: prepared.block.message, traceId }, { status: 409 });
  return Response.json({ action: actionView(prepared.action), traceId }, { status: 201 });
});
