import { env } from "cloudflare:workers";
import { requireOperationsAdmin } from "@/lib/auth/admin";
import { route } from "@/lib/http/route";

export const GET = route("ops.growth.data_requests.get", { unavailable: "data_requests_unavailable" }, async (request: Request, { traceId }) => {
  await requireOperationsAdmin(request);
  const rows = await env.PROJECTION_DB.prepare("SELECT request_id, subject_reference, request_type, status, requested_at, completed_at, handled_by FROM growth_data_requests ORDER BY requested_at DESC LIMIT 100").all();
  return Response.json({ requests: rows.results, traceId }, { headers: { "Cache-Control": "no-store" } });
});
