import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

type IntentRow = { intent_id: string; intent_type: string; status: string; transaction_hash: string | null; request_json: string; created_at: string; updated_at: string; confirmed_at: string | null; failure_reason: string | null; chain_id: number; last_checked_at: string | null; route_reference: string | null };
type EventRow = { intent_id: string; event_type: string; occurred_at: string };

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const result = await env.PROJECTION_DB.prepare(`SELECT intent_id, intent_type, status, transaction_hash, request_json, created_at, updated_at, confirmed_at, failure_reason, chain_id, last_checked_at, route_reference
      FROM transaction_intents WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 50`).bind(subject.subjectReference).all<IntentRow>();
    const events = await env.PROJECTION_DB.prepare(`SELECT e.intent_id, e.event_type, e.occurred_at FROM intent_events e
      WHERE e.intent_id IN (SELECT intent_id FROM transaction_intents WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 50)
      ORDER BY e.occurred_at ASC LIMIT 500`).bind(subject.subjectReference).all<EventRow>();
    const eventsByIntent = new Map<string, Array<{ type: string; occurredAt: string }>>();
    for (const event of events.results) eventsByIntent.set(event.intent_id, [...(eventsByIntent.get(event.intent_id) ?? []), { type: event.event_type, occurredAt: event.occurred_at }]);
    const intents = result.results.map((row) => {
      let requestData: Record<string, unknown> = {};
      try { requestData = JSON.parse(row.request_json) as Record<string, unknown>; } catch { /* malformed historical projection */ }
      return { intentId: row.intent_id, type: row.intent_type, status: row.status, transactionHash: row.transaction_hash ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, confirmedAt: row.confirmed_at ?? undefined, failureReason: row.failure_reason ?? undefined, chainId: row.chain_id, lastCheckedAt: row.last_checked_at ?? undefined, routeReference: row.route_reference ?? undefined, asset: typeof requestData.asset === "string" ? requestData.asset : undefined, amount: typeof requestData.amount === "string" ? requestData.amount : undefined, destination: typeof requestData.destination === "string" ? requestData.destination : undefined, estimatedUsd: typeof requestData.estimatedUsd === "number" ? requestData.estimatedUsd : undefined, events: eventsByIntent.get(row.intent_id) ?? [] };
    });
    return Response.json({ intents, observedAt: new Date().toISOString(), authority: "Aurel policy-intent audit projection" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    console.error(JSON.stringify({ level: "error", event: "activity.read.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "activity_unavailable", traceId }, { status: 503 });
  }
}
