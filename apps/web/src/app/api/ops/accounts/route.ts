import { env } from "cloudflare:workers";
import { checkClosure, findSubject } from "@/lib/account/closure";
import { requireOperationsAdmin } from "@/lib/auth/admin";
import { errorResponse, route } from "@/lib/http/route";

/** Find a customer by Privy user ID, email, or wallet address, with whether their account can be closed. */
export const GET = route("ops.accounts.get", { unavailable: "account_lookup_unavailable" }, async (request, context) => {
  await requireOperationsAdmin(request);
  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.trim().length < 3 || query.length > 200) return errorResponse(400, "invalid_query", context, { message: "Search by Privy user ID, email, or wallet address." });
  const subject = await findSubject(query);
  if (!subject) return errorResponse(404, "account_not_found", context, { message: "No customer matches that search." });
  return Response.json({ account: await checkClosure(env.PROJECTION_DB, subject), traceId: context.traceId });
});
