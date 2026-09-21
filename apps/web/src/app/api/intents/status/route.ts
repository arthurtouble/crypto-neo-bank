import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

const statusSchema = z.object({
  intentId: z.string().uuid(),
  status: z.enum(["submitted", "cancelled", "failed"]),
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional()
}).refine((value) => value.status !== "submitted" || Boolean(value.transactionHash), { message: "Submitted transactions require a hash." });

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const input = statusSchema.parse(await request.json());
    const result = await env.PROJECTION_DB.prepare(`UPDATE transaction_intents
      SET status = ?, transaction_hash = ?, updated_at = ?
      WHERE intent_id = ? AND subject_reference = ?`)
      .bind(input.status, input.transactionHash ?? null, new Date().toISOString(), input.intentId, subject.subjectReference).run();
    if ((result.meta.changes ?? 0) === 0) return Response.json({ error: "intent_not_found", traceId }, { status: 404 });
    return Response.json({ updated: true, traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_status", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "intent.status.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "status_unavailable", traceId }, { status: 503 });
  }
}

