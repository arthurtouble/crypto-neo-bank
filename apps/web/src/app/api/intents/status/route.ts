import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, requireFeature, type FeatureKey } from "@/lib/features/flags";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { observeTransactionIdentity } from "@/lib/transactions/chain-observation";
import { matchesPreparedCall, type NormalizedPreparedCall } from "@/lib/transactions/evidence";
import { REPORTED_HASH_CLAIM_SQL, TERMINAL_INTENT_AUDIT_SQL, TERMINAL_INTENT_CANCEL_SQL, TERMINAL_INTENT_FAIL_SQL, TERMINAL_PRODUCT_EVENT_SQL } from "@/lib/transactions/status-sql";

const statusSchema = z.object({
  intentId: z.string().uuid(),
  status: z.enum(["submitted", "cancelled", "failed"]),
  stepIndex: z.number().int().min(0).max(7).optional(),
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  failureReason: z.string().max(500).optional()
}).strict().superRefine((value, context) => {
  if (value.status === "submitted" && (!value.transactionHash || value.stepIndex === undefined)) {
    context.addIssue({ code: "custom", message: "Submitted transactions require a prepared step and hash." });
  }
  if (value.status !== "submitted" && (value.transactionHash || value.stepIndex !== undefined)) {
    context.addIssue({ code: "custom", message: "Only a submitted transaction may report a step and hash." });
  }
});

const transitions: Record<string, string[]> = {
  reviewed: ["submitted", "cancelled", "failed"],
  submitted: [],
  cooling: [], blocked: [], cancelled: [], failed: [], confirmed: []
};

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const intentId = z.string().uuid().parse(new URL(request.url).searchParams.get("intentId"));
    const intent = await env.PROJECTION_DB.prepare(`SELECT intent_id, status, intent_type AS type, chain_id, transaction_hash, route_reference,
      failure_reason, updated_at, confirmed_at,
      (SELECT CASE WHEN COUNT(*) = 0 THEN 'unverified_legacy'
        WHEN SUM(CASE WHEN p.submission_phase = 'awaiting_step_up' THEN 1 ELSE 0 END) > 0 THEN 'awaiting_step_up'
        WHEN transaction_intents.status = 'confirmed' AND SUM(CASE WHEN p.verification_state = 'confirmed' THEN 1 ELSE 0 END) = COUNT(*) THEN 'confirmed'
        WHEN SUM(CASE WHEN p.verification_state IN ('reorged', 'inconsistent', 'failed') THEN 1 ELSE 0 END) > 0 THEN 'exception'
        ELSE 'pending' END FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id) AS verification_state
      FROM transaction_intents WHERE intent_id = ? AND subject_reference = ?`)
      .bind(intentId, subject.subjectReference)
      .first<{ intent_id: string; status: string; type: string; chain_id: number; transaction_hash: string | null; route_reference: string | null; failure_reason: string | null; updated_at: string; confirmed_at: string | null; verification_state?: string }>();
    if (!intent) return Response.json({ error: "intent_not_found", traceId }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ intentId: intent.intent_id, status: intent.status, verificationState: intent.verification_state ?? "unverified_legacy", type: intent.type, chainId: intent.chain_id, transactionHash: intent.transaction_hash, routeReference: intent.route_reference, failureReason: intent.failure_reason, updatedAt: intent.updated_at, confirmedAt: intent.confirmed_at, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_intent", issues: error.issues, traceId }, { status: 400, headers: { "Cache-Control": "no-store" } });
    console.error(JSON.stringify({ level: "error", event: "intent.status.read_failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "status_unavailable", traceId }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const input = statusSchema.parse(await request.json());
    const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    const current = await env.PROJECTION_DB.prepare("SELECT status, expires_at, wallet_reference, intent_type FROM transaction_intents WHERE intent_id = ? AND subject_reference = ?")
      .bind(input.intentId, subject.subjectReference).first<{ status: string; expires_at: string; wallet_reference: string; intent_type: string }>();
    if (!current) return reply({ error: "intent_not_found", traceId }, 404);
    if (input.status === "submitted") {
      const stepIndex = input.stepIndex!;
      const hash = input.transactionHash!;
      if (!["reviewed", "submitted", "confirmed"].includes(current.status)) return reply({ error: "intent_expired_or_unreviewed", traceId }, 409);
      const prepared = await env.PROJECTION_DB.prepare(`SELECT intent_id, step_index, wallet_address, chain_id, target_address, native_value, calldata_hash, call_fingerprint, semantic_action, source_reference, expires_at, expected_effect_json, reported_hash, verification_state, submission_phase
        FROM intent_prepared_calls WHERE intent_id = ? AND step_index = ? AND subject_reference = ?`)
        .bind(input.intentId, stepIndex, subject.subjectReference).first<{
          intent_id: string; step_index: number; wallet_address: string; chain_id: number; target_address: string; native_value: string; calldata_hash: string; call_fingerprint: string; semantic_action: string; source_reference: string; expires_at: string; expected_effect_json: string; reported_hash: string | null; verification_state: string; submission_phase: string | null;
        }>();
      if (!prepared) return reply({ error: "prepared_step_required", traceId }, 409);
      if (prepared.submission_phase === "awaiting_step_up") return reply({ error: "prepared_step_unavailable", traceId }, 409);
      if (!["prepared", "pending", "reported", "confirmed"].includes(prepared.verification_state)) return reply({ error: "prepared_step_unavailable", traceId }, 409);
      const ownedAddress = await requireLinkedEvmWallet(subject.subjectReference, prepared.wallet_address);
      if (current.wallet_reference !== `wallet:${ownedAddress}`) return reply({ error: "wallet_mismatch", traceId }, 409);
      if (prepared.reported_hash && prepared.reported_hash.toLowerCase() !== hash.toLowerCase()) return reply({ error: "hash_conflict", traceId }, 409);
      if (prepared.reported_hash) return reply({ intentId: input.intentId, stepIndex, verificationState: prepared.verification_state, traceId }, prepared.verification_state === "pending" ? 202 : 200);
      if (current.status === "confirmed") return reply({ error: "intent_expired_or_unreviewed", traceId }, 409);
      if (current.expires_at <= new Date().toISOString()) return reply({ error: "intent_expired_or_unreviewed", traceId }, 409);
      if (prepared.expires_at <= new Date().toISOString()) return reply({ error: "prepared_step_unavailable", traceId }, 409);
      await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
      const feature: FeatureKey = current.intent_type === "swap" ? "swaps" : current.intent_type === "bridge" ? "cross_chain" : current.intent_type.startsWith("earn_") || ["borrow", "repay"].includes(current.intent_type) ? "defi_actions" : "direct_transfers";
      await requireFeature(env.PROJECTION_DB, feature);
      const lock = await env.PROJECTION_DB.prepare("SELECT account_locked FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference).first<{ account_locked: number }>();
      if (!lock || lock.account_locked) return reply({ error: "account_locked", traceId }, 403);
      const claimed = await env.PROJECTION_DB.prepare(REPORTED_HASH_CLAIM_SQL)
        .bind(hash.toLowerCase(), new Date().toISOString(), input.intentId, stepIndex, hash, subject.subjectReference).run();
      if (claimed.meta.changes !== 1) return reply({ error: "hash_conflict", traceId }, 409);
      const observation = await observeTransactionIdentity(prepared.chain_id, hash);
      if (observation.status === "pending") return reply({ intentId: input.intentId, stepIndex, verificationState: "pending", traceId }, 202);
      const preparedCall: NormalizedPreparedCall = { chainId: prepared.chain_id, from: prepared.wallet_address as `0x${string}`, to: prepared.target_address as `0x${string}`, value: prepared.native_value, data: "0x", dataHash: prepared.calldata_hash as `0x${string}`, fingerprint: prepared.call_fingerprint as `0x${string}` };
      const match = await matchesPreparedCall(preparedCall, observation.call);
      if (!match.matches) {
        const now = new Date().toISOString();
        await env.PROJECTION_DB.prepare("UPDATE intent_prepared_calls SET verification_state = 'inconsistent', updated_at = ? WHERE intent_id = ? AND step_index = ? AND lower(reported_hash) = lower(?)")
          .bind(now, input.intentId, stepIndex, hash).run();
        await env.PROJECTION_DB.prepare(`INSERT INTO operational_issues (issue_id, subject_reference, issue_type, severity, source_name, source_reference, summary, status, opened_at)
          VALUES (?, ?, 'transaction_identity_mismatch', 'high', 'onchain', ?, ?, 'open', ?)`).bind(crypto.randomUUID(), subject.subjectReference, hash.toLowerCase(), `Prepared step ${stepIndex} mismatched: ${match.reason}`, now).run();
        return reply({ error: "transaction_mismatch", reason: match.reason, traceId }, 409);
      }
      const now = new Date().toISOString();
      const bound = await env.PROJECTION_DB.prepare(`UPDATE intent_prepared_calls SET verification_state = 'reported', observed_block_hash = ?, updated_at = ?
        WHERE intent_id = ? AND step_index = ? AND lower(reported_hash) = lower(?) AND verification_state = 'pending'`)
        .bind(observation.blockHash, now, input.intentId, stepIndex, hash).run();
      if (bound.meta.changes !== 1) return reply({ error: "binding_conflict", traceId }, 409);
      const submitted = await env.PROJECTION_DB.prepare(`UPDATE transaction_intents SET status = 'submitted', transaction_hash = ?, route_reference = ?, updated_at = ?
        WHERE intent_id = ? AND subject_reference = ? AND status IN ('reviewed', 'submitted')`).bind(hash.toLowerCase(), prepared.source_reference, now, input.intentId, subject.subjectReference).run();
      if (submitted.meta.changes !== 1) return reply({ error: "binding_conflict", traceId }, 409);
      await env.PROJECTION_DB.prepare(`INSERT INTO intent_events (event_id, intent_id, subject_reference, event_type, evidence_json, occurred_at)
        VALUES (?, ?, ?, 'transaction_identity_matched', ?, ?)`).bind(crypto.randomUUID(), input.intentId, subject.subjectReference, JSON.stringify({ stepIndex, transactionHash: hash.toLowerCase(), fingerprint: prepared.call_fingerprint }), now).run();
      return reply({ updated: true, intentId: input.intentId, stepIndex, verificationState: "reported", traceId });
    }
    // A browser cannot establish that a routed transfer failed. A submitted
    // source transaction may still settle or refund on the destination chain.
    if (input.status === "failed" && ["swap", "bridge"].includes(current.intent_type))
      return reply({ error: "settlement_evidence_required", traceId }, 409);
    if (!(transitions[current.status] ?? []).includes(input.status)) return reply({ error: "invalid_transition", message: `A ${current.status} intent cannot become ${input.status}.`, traceId }, 409);
    const reported = await env.PROJECTION_DB.prepare(`SELECT 1 AS reported FROM intent_prepared_calls
      WHERE intent_id = ? AND subject_reference = ? AND reported_hash IS NOT NULL LIMIT 1`)
      .bind(input.intentId, subject.subjectReference).first<{ reported: number }>();
    if (reported) return reply({ error: "transaction_pending", traceId }, 409);
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const eventType = `intent_${input.status}`;
    const changes = await env.PROJECTION_DB.batch([
      input.status === "cancelled"
        ? env.PROJECTION_DB.prepare(TERMINAL_INTENT_CANCEL_SQL).bind(now, input.intentId, subject.subjectReference)
        : env.PROJECTION_DB.prepare(TERMINAL_INTENT_FAIL_SQL).bind(input.failureReason ?? null, now, input.intentId, subject.subjectReference),
      env.PROJECTION_DB.prepare(TERMINAL_INTENT_AUDIT_SQL)
        .bind(eventId, eventType, JSON.stringify({ failureReason: input.failureReason }), now,
          input.intentId, subject.subjectReference, input.status, now, input.intentId, eventType, now),
      env.PROJECTION_DB.prepare(TERMINAL_PRODUCT_EVENT_SQL)
        .bind(crypto.randomUUID(), subject.subjectReference, subject.sessionReference, "transaction_prepared",
          JSON.stringify({ intentId: input.intentId, status: input.status }), now, eventId, input.intentId, subject.subjectReference)
    ]);
    if (changes[0].meta.changes !== 1 || changes[1].meta.changes !== 1 || changes[2].meta.changes !== 1) {
      return reply({ error: "transaction_pending", traceId }, 409);
    }
    return reply({ updated: true, traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (error instanceof WalletOwnershipError) return Response.json({ error: "wallet_not_linked", traceId }, { status: 403, headers: { "Cache-Control": "no-store" } });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code, traceId }, { status: 403, headers: { "Cache-Control": "no-store" } });
    if (error instanceof FeatureUnavailableError) return Response.json({ error: "feature_unavailable", traceId }, { status: 503, headers: { "Cache-Control": "no-store" } });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_status", issues: error.issues, traceId }, { status: 400, headers: { "Cache-Control": "no-store" } });
    console.error(JSON.stringify({ level: "error", event: "intent.status.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "status_unavailable", traceId }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
