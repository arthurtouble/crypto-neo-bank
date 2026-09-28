import { env } from "cloudflare:workers";
import { requireOperator } from "@/lib/auth/access";
import { errorResponse, route } from "@/lib/http/route";
import { listCustomers, readCustomerCursor } from "@/lib/ops/customers";

/** Every customer, newest sign-up first, 50 at a time; `after` is the previous page's `next`. */
export const GET = route("ops.customers.get", { unavailable: "customers_unavailable" }, async (request, context) => {
  await requireOperator(request);
  const params = new URL(request.url).searchParams;
  const cursor = params.get("after");
  const after = readCustomerCursor(cursor);
  if (cursor && !after) return errorResponse(400, "invalid_cursor", context, { message: "That page link isn't valid. Start from the first page." });
  const limit = Number(params.get("limit") ?? 50);
  return Response.json({ ...await listCustomers(env.PROJECTION_DB, { limit: Number.isFinite(limit) ? limit : 50, ...(after ? { after } : {}) }), traceId: context.traceId },
    { headers: { "Cache-Control": "no-store" } });
});
