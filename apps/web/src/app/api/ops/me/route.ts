import { requireOperator } from "@/lib/auth/access";
import { route } from "@/lib/http/route";

/** Who is signed in to the operations app, from their Cloudflare Access token. */
export const GET = route("ops.me.get", { unavailable: "operator_unavailable" }, async (request, { traceId }) => {
  const operator = await requireOperator(request);
  return Response.json({ email: operator.email, traceId }, { headers: { "Cache-Control": "no-store" } });
});
