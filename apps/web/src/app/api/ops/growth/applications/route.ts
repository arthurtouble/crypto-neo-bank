import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";
import { applicationStatuses, listApplications } from "@/lib/growth/operations";

const querySchema = z.object({ status: z.enum(applicationStatuses).optional(), country: z.string().regex(/^[A-Z]{2}$/).optional(), primaryJob: z.enum(["receive","see","protect","earn","spend","move","treasury","other"]).optional(), source: z.string().max(100).optional(), campaign: z.string().max(120).optional(), ageDays: z.coerce.number().int().min(1).max(365).optional(), cursor: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireOperationsAdmin(request);
    const url = new URL(request.url); const input = querySchema.parse(Object.fromEntries(url.searchParams));
    return Response.json({ ...(await listApplications(env.PROJECTION_DB, input)), traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", traceId }, { status: 403 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_growth_filters", issues: error.issues, traceId }, { status: 400 });
    return Response.json({ error: "growth_queue_unavailable", traceId }, { status: 503 });
  }
}
