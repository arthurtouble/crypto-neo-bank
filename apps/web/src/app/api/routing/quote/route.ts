import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { getUsdcRoute, routeRequestSchema } from "@/lib/routing/lifi";
import { z } from "zod";

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireVerifiedSubject(request);
    const input = routeRequestSchema.parse(await request.json());
    const result = await getUsdcRoute(input);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_route", message: error.issues[0]?.message, traceId }, { status: 400 });
    return Response.json({ error: "route_unavailable", message: error instanceof Error ? error.message : "No route is currently available.", traceId }, { status: 503 });
  }
}
