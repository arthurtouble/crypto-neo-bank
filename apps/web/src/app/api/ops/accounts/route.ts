import { env } from "cloudflare:workers";
import { checkClosure } from "@/lib/account/closure";
import { requireOperator } from "@/lib/auth/access";
import { errorResponse, route } from "@/lib/http/route";
import { customerProfile, findCustomer } from "@/lib/ops/customers";

/** Find a customer by Privy user ID, email, wallet address, or Aura tag: their profile, holdings, and whether the account can be closed. */
export const GET = route("ops.accounts.get", { unavailable: "account_lookup_unavailable" }, async (request, context) => {
  await requireOperator(request);
  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.trim().length < 3 || query.length > 200) return errorResponse(400, "invalid_query", context, { message: "Search by Privy user ID, email, wallet address, or Aura tag." });
  const subject = await findCustomer(env.PROJECTION_DB, query);
  if (!subject) return errorResponse(404, "account_not_found", context, { message: "No customer matches that search." });
  const [account, profile] = await Promise.all([checkClosure(env.PROJECTION_DB, subject), customerProfile(env.PROJECTION_DB, subject)]);
  return Response.json({ account, profile, traceId: context.traceId }, { headers: { "Cache-Control": "no-store" } });
});
