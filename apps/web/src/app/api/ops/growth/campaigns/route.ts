import { env } from "cloudflare:workers";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";

const noStore = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try {
    await requireOperationsAdmin(request);
    const rows = await env.PROJECTION_DB.prepare("SELECT * FROM growth_campaigns ORDER BY created_at DESC LIMIT 100").all();
    return Response.json({ campaigns: rows.results }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403, headers: noStore });
    return Response.json({ error: "campaigns_unavailable" }, { status: 503, headers: noStore });
  }
}
export async function POST(request: Request) {
  try {
    await requireOperationsAdmin(request);
    return Response.json({ error: "growth_campaigns_retired" }, { status: 410, headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403, headers: noStore });
    return Response.json({ error: "campaigns_unavailable" }, { status: 503, headers: noStore });
  }
}
