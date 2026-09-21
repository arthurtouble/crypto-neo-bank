import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

const statusSchema = z.object({
  intentId: z.string().uuid(),
  status: z.enum(["submitted", "cancelled", "failed"]),
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  routeReference: z.string().max(200).optional(),
  failureReason: z.string().max(500).optional()
}).refine((value) => value.status !== "submitted" || Boolean(value.transactionHash), { message: "Submitted transactions require a hash." });

const transitions: Record<string, string[]> = {
  reviewed: ["submitted", "cancelled", "failed"],
  submitted: ["failed"],
  cooling: [], blocked: [], cancelled: [], failed: [], confirmed: []
};

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const input = statusSchema.parse(await request.json());
    const current = await env.PROJECTION_DB.prepare("SELECT status, expires_at FROM transaction_intents WHERE intent_id = ? AND subject_reference = ?").bind(input.intentId, subject.subjectReference).first<{ status: string; expires_at: string }>();
    if (!current) return Response.json({ error: "intent_not_found", traceId }, { status: 404 });
    if (!(transitions[current.status] ?? []).includes(input.status)) return Response.json({ error: "invalid_transition", message: `A ${current.status} intent cannot become ${input.status}.`, traceId }, { status: 409 });
    if (input.status === "submitted" && new Date(current.expires_at) < new Date()) return Response.json({ error: "intent_expired", message: "This review expired. Prepare the transaction again.", traceId }, { status: 409 });
    const now = new Date().toISOString();
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`UPDATE transaction_intents
        SET status = ?, transaction_hash = COALESCE(?, transaction_hash), route_reference = COALESCE(?, route_reference), failure_reason = ?, updated_at = ?
        WHERE intent_id = ? AND subject_reference = ?`)
        .bind(input.status, input.transactionHash ?? null, input.routeReference ?? null, input.failureReason ?? null, now, input.intentId, subject.subjectReference),
      env.PROJECTION_DB.prepare(`INSERT INTO intent_events (event_id, intent_id, subject_reference, event_type, evidence_json, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), input.intentId, subject.subjectReference, `intent_${input.status}`, JSON.stringify({ transactionHash: input.transactionHash, routeReference: input.routeReference, failureReason: input.failureReason }), now),
      env.PROJECTION_DB.prepare(`INSERT INTO product_events (event_id, subject_reference, session_reference, event_name, surface, properties_json, occurred_at)
        VALUES (?, ?, ?, ?, '/app/activity', ?, ?)`)
        .bind(crypto.randomUUID(), subject.subjectReference, subject.sessionReference, input.status === "submitted" ? "transaction_submitted" : "transaction_prepared", JSON.stringify({ intentId: input.intentId, status: input.status }), now)
    ]);
    return Response.json({ updated: true, traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_status", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "intent.status.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "status_unavailable", traceId }, { status: 503 });
  }
}
