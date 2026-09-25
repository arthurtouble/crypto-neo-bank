import { env } from "cloudflare:workers";
import { z } from "zod";
import { getAction, recordSubmission } from "@/lib/actions/store";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { errorResponse, route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { actionView } from "../../view";

const schema = z.strictObject({ transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/) });

/** Record the transaction hash the smart wallet returned. The chain, not this report, decides the outcome. */
export const POST = route("actions.submit", { invalid: "invalid_submission", unavailable: "submission_unavailable" },
  async (request, context, { params }: { params: Promise<{ id: string }> }) => {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "action_submit", subject: subject.subjectReference, limit: 30, windowSeconds: 60 });
    const { transactionHash } = schema.parse(await request.json());
    const action = await getAction(env.PROJECTION_DB, subject.subjectReference, (await params).id);
    if (!action) return errorResponse(404, "action_not_found", context);
    const now = new Date();
    const result = await recordSubmission(env.PROJECTION_DB, action, transactionHash, now);
    if (result === "hash_in_use") return errorResponse(409, "hash_in_use", context, { message: "This transaction is already linked to another action." });
    if (result === "not_submittable") return errorResponse(409, "not_submittable", context, { message: "This action already has a different transaction." });
    const current = await getAction(env.PROJECTION_DB, subject.subjectReference, action.id);
    return Response.json({ action: actionView(current!), traceId: context.traceId }, { status: result === "submitted" ? 202 : 200 });
  });
