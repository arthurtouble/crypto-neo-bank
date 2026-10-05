import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOperator } from "@/lib/auth/access";
import { route } from "@/lib/http/route";
import { listMovement, readMovementCursor } from "@/lib/ops/movement";

const querySchema = z.object({
  status: z.enum(["submitted", "settling", "confirmed", "failed", "expired"]).optional(),
  kind: z.enum(["transfer", "earn", "route", "received", "card"]).optional(),
  subject: z.string().startsWith("did:privy:").max(120).optional(),
  stuck: z.enum(["1"]).optional(),
  // The `next` cursor of the page before, or an ISO time.
  before: z.string().max(400).transform((value, context) => readMovementCursor(value) ?? (context.addIssue({ code: "custom", message: "Not a page cursor." }), z.NEVER)).optional()
});

/** Money moving across every customer, newest first, 50 at a time: Aura actions, money received from outside Aura, and card payments. */
export const GET = route("ops.movement.get", { unavailable: "movement_unavailable", invalid: "invalid_filter" }, async (request, { traceId }) => {
  await requireOperator(request);
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return Response.json({ ...await listMovement(env.PROJECTION_DB, { ...query, stuck: query.stuck === "1" }), traceId }, { headers: { "Cache-Control": "no-store" } });
});
