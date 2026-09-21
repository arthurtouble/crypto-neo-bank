import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

const RPC_BY_CHAIN: Record<number, string[]> = {
  1: ["https://ethereum-rpc.publicnode.com"],
  10: ["https://mainnet.optimism.io"],
  137: ["https://polygon-bor-rpc.publicnode.com"],
  8453: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  42161: ["https://arb1.arbitrum.io/rpc"]
};

type IntentRow = { intent_id: string; chain_id: number; transaction_hash: string; status: string };
type Receipt = { status?: string; blockNumber?: string };

async function readReceipt(chainId: number, hash: string): Promise<Receipt | null> {
  const endpoints = RPC_BY_CHAIN[chainId];
  if (!endpoints) return null;
  let lastError = "No RPC endpoint responded.";
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }), signal: AbortSignal.timeout(8_000) });
      if (!response.ok) { lastError = `RPC ${chainId} returned ${response.status}.`; continue; }
      const body = await response.json() as { result?: Receipt | null; error?: { message?: string } };
      if (body.error) { lastError = body.error.message ?? "Receipt lookup failed."; continue; }
      return body.result ?? null;
    } catch (error) { lastError = error instanceof Error ? error.message : "Receipt lookup failed."; }
  }
  throw new Error(lastError);
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const pending = await env.PROJECTION_DB.prepare(`SELECT intent_id, chain_id, transaction_hash, status FROM transaction_intents
      WHERE subject_reference = ? AND status = 'submitted' AND transaction_hash IS NOT NULL ORDER BY updated_at ASC LIMIT 20`)
      .bind(subject.subjectReference).all<IntentRow>();
    const results: Array<{ intentId: string; status: string }> = [];
    for (const intent of pending.results) {
      const now = new Date().toISOString();
      try {
        const receipt = await readReceipt(intent.chain_id, intent.transaction_hash);
        if (!receipt) {
          await env.PROJECTION_DB.prepare("UPDATE transaction_intents SET last_checked_at = ? WHERE intent_id = ?").bind(now, intent.intent_id).run();
          results.push({ intentId: intent.intent_id, status: "submitted" });
          continue;
        }
        const nextStatus = receipt.status === "0x1" ? "confirmed" : "failed";
        await env.PROJECTION_DB.batch([
          env.PROJECTION_DB.prepare(`UPDATE transaction_intents SET status = ?, source_block = ?, confirmed_at = CASE WHEN ? = 'confirmed' THEN ? ELSE confirmed_at END, failure_reason = CASE WHEN ? = 'failed' THEN 'Transaction reverted onchain.' ELSE failure_reason END, last_checked_at = ?, updated_at = ? WHERE intent_id = ? AND status = 'submitted'`)
            .bind(nextStatus, receipt.blockNumber ?? null, nextStatus, now, nextStatus, now, now, intent.intent_id),
          env.PROJECTION_DB.prepare(`INSERT INTO intent_events (event_id, intent_id, subject_reference, event_type, evidence_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(crypto.randomUUID(), intent.intent_id, subject.subjectReference, `intent_${nextStatus}`, JSON.stringify({ transactionHash: intent.transaction_hash, sourceBlock: receipt.blockNumber }), now)
        ]);
        results.push({ intentId: intent.intent_id, status: nextStatus });
      } catch (error) {
        console.error(JSON.stringify({ level: "warning", event: "intent.reconcile.lookup_failed", traceId, intentId: intent.intent_id, chainId: intent.chain_id, message: error instanceof Error ? error.message : "unknown" }));
        results.push({ intentId: intent.intent_id, status: "check_failed" });
      }
    }
    return Response.json({ checked: results.length, results, traceId, observedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    console.error(JSON.stringify({ level: "error", event: "intent.reconcile.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "reconciliation_unavailable", traceId }, { status: 503 });
  }
}
