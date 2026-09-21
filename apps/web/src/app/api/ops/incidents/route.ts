import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";

const schema = z.object({ title: z.string().trim().min(4).max(120), status: z.enum(["investigating", "identified", "monitoring", "resolved"]), impact: z.string().trim().min(4).max(240), message: z.string().trim().min(10).max(2000), published: z.boolean().default(false) });

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireOperationsAdmin(request);
    const input = schema.parse(await request.json());
    const now = new Date().toISOString();
    const incidentId = crypto.randomUUID();
    await env.PROJECTION_DB.prepare(`INSERT INTO incident_updates (incident_id, title, status, impact, message, started_at, updated_at, resolved_at, published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(incidentId, input.title, input.status, input.impact, input.message, now, now, input.status === "resolved" ? now : null, input.published ? 1 : 0).run();
    return Response.json({ incidentId, traceId }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", traceId }, { status: 403 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_incident", issues: error.issues, traceId }, { status: 400 });
    return Response.json({ error: "incident_update_unavailable", traceId }, { status: 503 });
  }
}

