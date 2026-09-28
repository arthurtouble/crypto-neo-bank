import { env } from "cloudflare:workers";
import { z } from "zod";
import { checkClosure, reopenAccount } from "@/lib/account/closure";
import { requireOperator } from "@/lib/auth/access";
import { errorResponse, route } from "@/lib/http/route";

const schema = z.strictObject({ reason: z.string().trim().min(4).max(200) });

/** Reopen a closed account. It stays locked until the customer unlocks it with their passkey. */
export const POST = route("ops.accounts.reopen", { unavailable: "account_reopen_unavailable", invalid: "invalid_reason" },
  async (request, context, { params }: { params: Promise<{ subject: string }> }) => {
    const operator = await requireOperator(request);
    const subject = decodeURIComponent((await params).subject);
    const { reason } = schema.parse(await request.json());
    if (!await reopenAccount(env.PROJECTION_DB, subject, operator.email, reason)) return errorResponse(409, "not_closed", context, { message: "This account isn't closed." });
    return Response.json({ account: await checkClosure(env.PROJECTION_DB, subject), traceId: context.traceId });
  });
