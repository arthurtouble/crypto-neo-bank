import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";

export async function POST(request: Request) {
  try {
    await requireOperationsAdmin(request);
    return Response.json({ error: "local_delivery_retired" }, { status: 410, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403 });
    return Response.json({ error: "communications_unavailable" }, { status: 503 });
  }
}
