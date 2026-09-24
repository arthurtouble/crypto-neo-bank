import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    await requireOperationsAdmin(request);
    return Response.json({ error: "waitlist_retired" }, { status: 410, headers });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403, headers });
    return Response.json({ error: "waitlist_unavailable" }, { status: 503, headers });
  }
}
