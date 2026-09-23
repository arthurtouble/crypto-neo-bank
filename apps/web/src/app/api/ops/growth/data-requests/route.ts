import { env } from "cloudflare:workers";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireOperationsAdmin(request);
    const rows = await env.PROJECTION_DB.prepare("SELECT request_id, subject_reference, request_type, status, requested_at, completed_at, handled_by FROM growth_data_requests ORDER BY requested_at DESC LIMIT 100").all();
    return Response.json({ requests: rows.results, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", traceId }, { status: 403 });
    return Response.json({ error: "data_requests_unavailable", traceId }, { status: 503 });
  }
}
