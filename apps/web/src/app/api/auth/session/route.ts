import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

export async function GET(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request, { beforeTerms: true });
    return Response.json({ authenticated: true, subject });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ authenticated: false, error: error.message }, { status: 401 });
    }
    console.error(JSON.stringify({ level: "error", event: "auth.session.failed", message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ authenticated: false, error: "Authentication is temporarily unavailable." }, { status: 503 });
  }
}

