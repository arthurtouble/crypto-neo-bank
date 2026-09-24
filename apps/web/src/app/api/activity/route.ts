import { env } from "cloudflare:workers";
import { isAddress } from "viem";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { getAaveBaseActivity } from "@/lib/defi/aave";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { observationStatus } from "@/lib/activity/presentation";

type IntentRow = { intent_id: string; intent_type: string; status: string; transaction_hash: string | null; request_json: string; created_at: string; updated_at: string; confirmed_at: string | null; failure_reason: string | null; chain_id: number; last_checked_at: string | null; route_reference: string | null };
type EventRow = { intent_id: string; event_type: string; occurred_at: string };
type ObservationRow = { report_id: string; intent_id: string; step_index: number; chain_id: number; transaction_hash: string; verification_state: string; effect_reason: string | null; reported_at: string; last_checked_at: string | null };

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "activity_read", subject: subject.subjectReference, limit: 150, windowSeconds: 3600 });
    const address = new URL(request.url).searchParams.get("address");
    if (address && !isAddress(address)) return Response.json({ error: "invalid_address", traceId }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const [result, events, observationsResult, protocol] = await Promise.all([
      env.PROJECTION_DB.prepare(`SELECT intent_id, intent_type, status, transaction_hash, request_json, created_at, updated_at, confirmed_at, failure_reason, chain_id, last_checked_at, route_reference
        FROM transaction_intents WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 50`).bind(subject.subjectReference).all<IntentRow>(),
      env.PROJECTION_DB.prepare(`SELECT e.intent_id, e.event_type, e.occurred_at FROM intent_events e
        WHERE e.intent_id IN (SELECT intent_id FROM transaction_intents WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 50)
        ORDER BY e.occurred_at ASC LIMIT 500`).bind(subject.subjectReference).all<EventRow>(),
      env.PROJECTION_DB.prepare(`SELECT report_id, intent_id, step_index, chain_id, transaction_hash, verification_state, effect_reason, reported_at, last_checked_at
        FROM intent_observation_candidates WHERE subject_reference = ? ORDER BY reported_at DESC LIMIT 50`).bind(subject.subjectReference).all<ObservationRow>(),
      address ? getAaveBaseActivity(address).catch(() => ({ items: [], partial: false, sourceStatus: "unavailable" as const })) : Promise.resolve({ items: [], partial: false, sourceStatus: "none" as const })
    ]);
    const eventsByIntent = new Map<string, Array<{ type: string; occurredAt: string }>>();
    for (const event of events.results) eventsByIntent.set(event.intent_id, [...(eventsByIntent.get(event.intent_id) ?? []), { type: event.event_type, occurredAt: event.occurred_at }]);
    const intents = result.results.map((row) => {
      let requestData: Record<string, unknown> = {};
      try { requestData = JSON.parse(row.request_json) as Record<string, unknown>; } catch { /* malformed historical projection */ }
      return { intentId: row.intent_id, type: row.intent_type, status: row.status, transactionHash: row.transaction_hash ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, confirmedAt: row.confirmed_at ?? undefined, failureReason: row.failure_reason ?? undefined, chainId: row.chain_id, lastCheckedAt: row.last_checked_at ?? undefined, routeReference: row.route_reference ?? undefined, asset: typeof requestData.asset === "string" ? requestData.asset : undefined, amount: typeof requestData.amount === "string" ? requestData.amount : undefined, destination: typeof requestData.destination === "string" ? requestData.destination : undefined, estimatedUsd: typeof requestData.estimatedUsd === "number" ? requestData.estimatedUsd : undefined, events: eventsByIntent.get(row.intent_id) ?? [], source: "Aura", sourceKind: "projection" as const, authority: "Aura policy-intent audit projection" };
    });
    const localKeys = new Set(intents.filter((item) => item.transactionHash).map((item) => `${item.transactionHash?.toLowerCase()}:${item.type}`));
    const protocolIntents = protocol.items.filter((item) => !localKeys.has(`${item.transactionHash.toLowerCase()}:${item.type}`)).map((item) => ({ ...item, intentId: item.id }));
    const merged = [...intents, ...protocolIntents].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 100);
    const observations = observationsResult.results.map((row) => ({ reportId: row.report_id, intentId: row.intent_id, stepIndex: row.step_index, chainId: row.chain_id, transactionHash: row.transaction_hash, status: observationStatus(row.verification_state, row.effect_reason), reportedAt: row.reported_at, lastCheckedAt: row.last_checked_at }));
    return Response.json({
      intents: merged,
      observations,
      observedAt: new Date().toISOString(),
      authority: "Aura workflow evidence with source-reported Aave activity",
      sources: {
        aurel: { status: "available", count: intents.length, authority: "Aura policy-intent audit projection" },
        aave: { status: protocol.sourceStatus, count: protocolIntents.length, partial: protocol.partial, authority: "Aave Protocol API and Base" }
      }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", message: error.message, traceId }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    console.error(JSON.stringify({ level: "error", event: "activity.read.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "activity_unavailable", traceId }, { status: 503 });
  }
}
