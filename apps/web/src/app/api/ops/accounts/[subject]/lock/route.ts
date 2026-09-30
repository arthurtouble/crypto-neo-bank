import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOperator } from "@/lib/auth/access";
import { errorResponse, route, readJsonBody } from "@/lib/http/route";
import { customerProfile, lockAccount } from "@/lib/ops/customers";

const schema = z.strictObject({ reason: z.string().trim().min(4).max(200) });

/** Lock an account to protect its customer. Sending stops and the card is frozen; only the customer unlocks it, with their passkey. */
export const POST = route("ops.accounts.lock", { unavailable: "account_lock_unavailable", invalid: "invalid_reason" },
  async (request, context, { params }: { params: Promise<{ subject: string }> }) => {
    const operator = await requireOperator(request);
    const subject = decodeURIComponent((await params).subject);
    const { reason } = schema.parse(await readJsonBody(request));
    if (!subject.startsWith("did:privy:")) return errorResponse(400, "invalid_subject", context, { message: "That isn't a customer ID." });
    if (!await lockAccount(env.PROJECTION_DB, subject, operator.email, reason)) return errorResponse(409, "already_locked", context, { message: "This account is already locked." });
    return Response.json({ profile: await customerProfile(env.PROJECTION_DB, subject), traceId: context.traceId });
  });
