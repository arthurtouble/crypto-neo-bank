import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

export async function GET(request: Request) {
  try {
    await requireVerifiedSubject(request);
    return Response.json({ error: "swap_reminders_retired" }, { status: 410, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: "reminders_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
