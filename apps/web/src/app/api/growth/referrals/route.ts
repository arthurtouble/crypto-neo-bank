import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

const headers = { "Cache-Control": "no-store" };
async function retired(request: Request) {
  try {
    await requireVerifiedSubject(request);
    return Response.json({ error: "referrals_retired" }, { status: 410, headers });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    return Response.json({ error: "referrals_unavailable" }, { status: 503, headers });
  }
}

export const GET = retired;
export const POST = retired;
