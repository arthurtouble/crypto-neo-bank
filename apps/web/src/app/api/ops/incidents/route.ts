import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOperationsAdmin } from "@/lib/auth/admin";
import { route } from "@/lib/http/route";

const schema = z.object({ title: z.string().trim().min(4).max(120), status: z.enum(["investigating", "identified", "monitoring", "resolved"]), impact: z.string().trim().min(4).max(240), message: z.string().trim().min(10).max(2000), published: z.boolean().default(false) });

export const POST = route("ops.incidents.post", { unavailable: "incident_update_unavailable", invalid: "invalid_incident" }, async (request: Request, { traceId }) => {
  await requireOperationsAdmin(request);
  const input = schema.parse(await request.json());
  const now = new Date().toISOString();
  const incidentId = crypto.randomUUID();
  await env.PROJECTION_DB.prepare(`INSERT INTO incident_updates (incident_id, title, status, impact, message, started_at, updated_at, resolved_at, published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(incidentId, input.title, input.status, input.impact, input.message, now, now, input.status === "resolved" ? now : null, input.published ? 1 : 0).run();
  return Response.json({ incidentId, traceId }, { status: 201 });
});

