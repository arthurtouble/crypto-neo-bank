import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

async function retired(request: Request) {
  try {
    await requireVerifiedSubject(request);
    return Response.json({ error: "schedules_retired" }, { status: 410, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: "schedules_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = retired;
export const POST = retired;
