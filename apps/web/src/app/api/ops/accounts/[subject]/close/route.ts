import { env } from "cloudflare:workers";
import { z } from "zod";
import { checkClosure, closeAccount } from "@/lib/account/closure";
import { requireOperator } from "@/lib/auth/access";
import { errorResponse, route } from "@/lib/http/route";

const schema = z.strictObject({ reason: z.string().trim().min(4).max(200) });

/** Close an account at the customer's request. Refused unless it holds nothing and nothing is on its way, checked again now. */
export const POST = route("ops.accounts.close", { unavailable: "account_close_unavailable", invalid: "invalid_reason" },
  async (request, context, { params }: { params: Promise<{ subject: string }> }) => {
    const operator = await requireOperator(request);
    const subject = decodeURIComponent((await params).subject);
    const { reason } = schema.parse(await request.json());
    const check = await checkClosure(env.PROJECTION_DB, subject);
    if (check.closedAt) return errorResponse(409, "already_closed", context, { message: "This account is already closed." });
    if (!check.eligible) return errorResponse(409, "account_not_empty", context, { message: `The account can't be closed yet: ${check.blockers.join("; ")}.` });
    await closeAccount(env.PROJECTION_DB, subject, operator.email, reason);
    return Response.json({ account: await checkClosure(env.PROJECTION_DB, subject), traceId: context.traceId });
  });
