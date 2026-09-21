import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { getUsdcRoute, routeRequestSchema } from "@/lib/routing/lifi";
import { z } from "zod";
import { env } from "cloudflare:workers";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "routing_quote", subject: subject.subjectReference, limit: 30, windowSeconds: 600 });
    const input = routeRequestSchema.parse(await request.json());
    const result = await getUsdcRoute(input);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", message: error.message, traceId }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_route", message: error.issues[0]?.message, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "routing.quote.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "route_unavailable", message: "No validated route is currently available for this request.", traceId }, { status: 503 });
  }
}
