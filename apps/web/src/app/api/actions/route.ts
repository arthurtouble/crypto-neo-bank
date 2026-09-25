import { env } from "cloudflare:workers";
import { actionInputSchema, prepareAction } from "@/lib/actions/prepare";
import { listActions } from "@/lib/actions/store";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet } from "@/lib/auth/wallet";
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
  const wallet = await requireActionWallet(subject.subjectReference);
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const prepared = await prepareAction(env.PROJECTION_DB, subject.subjectReference, wallet, input);
  if (!prepared.ok) return Response.json({ error: prepared.block.code, message: prepared.block.message, traceId }, { status: 409 });
  return Response.json({ action: actionView(prepared.action), traceId }, { status: 201 });
});

/** The customer's recent actions, newest first. Prepared actions that were never signed are left out. */
export const GET = route("actions.list", { unavailable: "actions_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "actions_list", subject: subject.subjectReference, limit: 120, windowSeconds: 60 });
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50));
  return Response.json({ actions: (await listActions(env.PROJECTION_DB, subject.subjectReference, limit)).map(actionView), traceId });
});
