import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

type IntentRow = { intent_id: string; intent_type: string; status: string; transaction_hash: string | null; request_json: string; created_at: string; updated_at: string; confirmed_at: string | null; failure_reason: string | null; chain_id: number; last_checked_at: string | null };

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const result = await env.PROJECTION_DB.prepare(`SELECT intent_id, intent_type, status, transaction_hash, request_json, created_at, updated_at, confirmed_at, failure_reason, chain_id, last_checked_at
      FROM transaction_intents WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 50`).bind(subject.subjectReference).all<IntentRow>();
    const intents = result.results.map((row) => {
      let requestData: Record<string, unknown> = {};
      try { requestData = JSON.parse(row.request_json) as Record<string, unknown>; } catch { /* malformed historical projection */ }
      return { intentId: row.intent_id, type: row.intent_type, status: row.status, transactionHash: row.transaction_hash ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, confirmedAt: row.confirmed_at ?? undefined, failureReason: row.failure_reason ?? undefined, chainId: row.chain_id, lastCheckedAt: row.last_checked_at ?? undefined, asset: typeof requestData.asset === "string" ? requestData.asset : undefined, amount: typeof requestData.amount === "string" ? requestData.amount : undefined };
    });
    return Response.json({ intents, observedAt: new Date().toISOString(), authority: "Aurel policy-intent audit projection" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    console.error(JSON.stringify({ level: "error", event: "activity.read.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "activity_unavailable", traceId }, { status: 503 });
  }
}
