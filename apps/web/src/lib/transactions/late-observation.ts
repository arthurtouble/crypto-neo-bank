import { enforceRateLimit } from "@/lib/security/rate-limit";
import { observeTransaction } from "./chain-observation";
import { normalizePreparedCall } from "./evidence";
import { verifyExpectedEffect, type PreparedEffectEvidence } from "./effects";
import { verifySameChainSwapEffect } from "@/lib/swap/source-effect";
import { verifyCrossChainSourceEffect } from "@/lib/swap/cross-source-effect";

type Candidate = { report_id: string; intent_id: string; step_index: number; subject_reference: string };
type Input = { subjectReference: string; intentId: string; stepIndex: number; chainId: number; hash: string; fingerprint: string; phase: string | null; reason: string };

/** A late hash is evidence to investigate, never a new signing approval. */
export async function recordLateObservation(db: D1Database, input: Input): Promise<"recorded" | "conflict"> {
  await enforceRateLimit(db, { namespace: "late_observation", subject: input.subjectReference, limit: 10, windowSeconds: 3600 });
  const hash = input.hash.toLowerCase();
  const existing = await db.prepare(`SELECT report_id, intent_id, step_index, subject_reference FROM intent_observation_candidates
    WHERE chain_id = ? AND lower(transaction_hash) = ?`).bind(input.chainId, hash).first<Candidate>();
  if (existing) return existing.intent_id === input.intentId && existing.step_index === input.stepIndex && existing.subject_reference === input.subjectReference ? "recorded" : "conflict";
  const now = new Date().toISOString();
  let insertError: unknown;
  try {
    const inserted = await db.prepare(`INSERT INTO intent_observation_candidates
      (report_id, subject_reference, intent_id, step_index, chain_id, transaction_hash, prepared_fingerprint, prepared_phase,
        control_reasons_json, verification_state, reported_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unindexed', ? FROM intent_prepared_calls p
      JOIN transaction_intents i ON i.intent_id = p.intent_id
      WHERE p.intent_id = ? AND p.step_index = ? AND p.subject_reference = ? AND i.subject_reference = ?
        AND (i.intent_type = 'transfer' OR (i.intent_type IN ('swap', 'bridge')
          AND p.semantic_action = i.intent_type AND p.submission_phase = 'released'))
        AND p.chain_id = 8453 AND p.step_index = 0
        AND p.call_fingerprint = ? AND p.reported_hash IS NULL
        AND (SELECT COUNT(*) FROM intent_observation_candidates prior WHERE prior.intent_id = p.intent_id AND prior.step_index = p.step_index) < 5`)
      .bind(crypto.randomUUID(), input.subjectReference, input.intentId, input.stepIndex, input.chainId, hash, input.fingerprint,
        input.phase, JSON.stringify([input.reason]), now, input.intentId, input.stepIndex, input.subjectReference,
        input.subjectReference, input.fingerprint).run();
    if (inserted.meta.changes === 1) return "recorded";
  } catch (error) { insertError = error; }
  const raced = await db.prepare(`SELECT report_id, intent_id, step_index, subject_reference FROM intent_observation_candidates
    WHERE chain_id = ? AND lower(transaction_hash) = ?`).bind(input.chainId, hash).first<Candidate>();
  if (raced) return raced.intent_id === input.intentId && raced.step_index === input.stepIndex && raced.subject_reference === input.subjectReference ? "recorded" : "conflict";
  if (insertError) {
    const ordinary = await db.prepare(`SELECT 1 AS claimed FROM intent_prepared_calls WHERE chain_id = ? AND lower(reported_hash) = ? LIMIT 1`)
      .bind(input.chainId, hash).first<{ claimed: number }>();
    if (!ordinary) throw insertError;
  }
  return "conflict";
}

type PendingCandidate = { report_id: string; intent_id: string; step_index: number; transaction_hash: string; chain_id: number;
  wallet_address: string; target_address: string; native_value: string; calldata_hash: string;
  prepared_fingerprint: string; semantic_action: string;
  expected_effect_json: string; intent_status: string; intent_type: string };

/** Recheck independently; this never updates the ordinary prepared call or intent. */
export async function reconcileLateObservations(db: D1Database, subjectReference: string) {
  const rows = await db.prepare(`SELECT c.report_id, c.intent_id, c.step_index, c.transaction_hash, c.chain_id,
      p.wallet_address, p.target_address, p.native_value, p.calldata_hash, c.prepared_fingerprint,
      p.semantic_action, p.expected_effect_json,
      i.status AS intent_status, i.intent_type
    FROM intent_observation_candidates c
    JOIN intent_prepared_calls p ON p.intent_id = c.intent_id AND p.step_index = c.step_index
    JOIN transaction_intents i ON i.intent_id = c.intent_id
    WHERE c.subject_reference = ? AND i.subject_reference = ? AND p.call_fingerprint = c.prepared_fingerprint
      AND p.step_index = 0 AND p.chain_id = 8453
      AND (i.intent_type = 'transfer' OR (i.intent_type IN ('swap', 'bridge')
        AND p.semantic_action = i.intent_type AND p.submission_phase = 'released'))
    ORDER BY COALESCE(c.last_checked_at, c.reported_at) ASC, c.report_id ASC LIMIT 20`)
    .bind(subjectReference, subjectReference).all<PendingCandidate>();
  const results: Array<{ reportId: string; verificationState: string }> = [];
  for (const row of rows.results) {
    let state: "unindexed" | "identity_matched" | "identity_mismatch" | "settled" | "reverted" | "check_failed";
    let reason: string | null = null;
    let blockHash: string | null = null;
    let retainedEvidence: Record<string, unknown> = { chainId: row.chain_id, transactionHash: row.transaction_hash };
    try {
      const observed = await observeTransaction(row.chain_id, row.transaction_hash);
      blockHash = observed.status === "found" ? observed.canonicalBlockHash : null;
      if (observed.status === "found") retainedEvidence = { ...retainedEvidence,
        transactionBlockHash: observed.blockHash, canonicalBlockHash: observed.canonicalBlockHash,
        confirmations: observed.confirmations, finalizedBlockNumber: observed.finalizedBlockNumber?.toString() ?? null,
        receipt: observed.receipt ? { status: observed.receipt.status, transactionHash: observed.receipt.transactionHash,
          blockHash: observed.receipt.blockHash, blockNumber: observed.receipt.blockNumber.toString() } : null };
      let expectedEffect: unknown;
      try { expectedEffect = JSON.parse(row.expected_effect_json); } catch { expectedEffect = null; }
      const evidence: PreparedEffectEvidence = { chainId: row.chain_id, walletAddress: row.wallet_address,
        targetAddress: row.target_address, nativeValue: row.native_value, calldataHash: row.calldata_hash,
        semanticAction: row.semantic_action, expectedEffect, reportedHash: row.transaction_hash, observedBlockHash: null };
      const verified = row.intent_type === "bridge" ? await (async () => {
        if (observed.status === "pending") return { status: "pending" as const, reason: "transaction_unavailable" };
        let call;
        try { call = await normalizePreparedCall(observed.call); }
        catch { return { status: "inconsistent" as const, reason: "invalid_transaction" }; }
        if (call.fingerprint.toLowerCase() !== row.prepared_fingerprint.toLowerCase()
          || call.chainId !== row.chain_id || call.from.toLowerCase() !== row.wallet_address.toLowerCase()
          || call.to.toLowerCase() !== row.target_address.toLowerCase() || call.value !== row.native_value
          || call.dataHash.toLowerCase() !== row.calldata_hash.toLowerCase())
          return { status: "inconsistent" as const, reason: "transaction_identity" };
        if (!expectedEffect || typeof expectedEffect !== "object" || Array.isArray(expectedEffect))
          return { status: "inconsistent" as const, reason: "effect_schema" };
        const bridge = expectedEffect as Record<string, unknown>;
        if (bridge.type !== "bridge" || bridge.sourceChainId !== 8453
          || typeof bridge.destinationChainId !== "number" || ![1, 42161].includes(bridge.destinationChainId)
          || typeof bridge.wallet !== "string" || typeof bridge.recipient !== "string"
          || bridge.wallet.toLowerCase() !== row.wallet_address.toLowerCase()
          || bridge.recipient.toLowerCase() !== row.wallet_address.toLowerCase()
          || ["sourceAmountRaw", "bridgeAmountRaw", "bridgeOutputRaw", "minimumOutputRaw"]
            .some((field) => typeof bridge[field] !== "string")
          || typeof bridge.quoteTimestamp !== "number" || typeof bridge.fillDeadline !== "number")
          return { status: "inconsistent" as const, reason: "effect_schema" };
        return verifyCrossChainSourceEffect({ call, observed, expected: {
          wallet: bridge.wallet, recipient: bridge.recipient,
          sourceChainId: bridge.sourceChainId, destinationChainId: bridge.destinationChainId,
          sourceAmountRaw: bridge.sourceAmountRaw as string, bridgeAmountRaw: bridge.bridgeAmountRaw as string,
          bridgeOutputRaw: bridge.bridgeOutputRaw as string, minimumOutputRaw: bridge.minimumOutputRaw as string,
          quoteTimestamp: bridge.quoteTimestamp, fillDeadline: bridge.fillDeadline,
          reportedHash: row.transaction_hash
        } });
      })() : row.intent_type === "swap" ? await (async () => {
        if (observed.status === "pending") return { status: "pending" as const, reason: "transaction_unavailable" };
        let call;
        try { call = await normalizePreparedCall(observed.call); }
        catch { return { status: "inconsistent" as const, reason: "invalid_transaction" }; }
        if (call.chainId !== row.chain_id || call.from.toLowerCase() !== row.wallet_address.toLowerCase()
          || call.to.toLowerCase() !== row.target_address.toLowerCase() || call.value !== row.native_value
          || call.dataHash.toLowerCase() !== row.calldata_hash.toLowerCase())
          return { status: "inconsistent" as const, reason: "transaction_identity" };
        if (!expectedEffect || typeof expectedEffect !== "object" || Array.isArray(expectedEffect))
          return { status: "inconsistent" as const, reason: "effect_schema" };
        const swap = expectedEffect as Record<string, unknown>;
        if (swap.type !== "swap" || ["wallet", "sourceAssetId", "destinationAssetId", "sourceAmountRaw", "minimumOutputRaw"]
          .some((field) => typeof swap[field] !== "string"))
          return { status: "inconsistent" as const, reason: "effect_schema" };
        return verifySameChainSwapEffect({ call, observed, expected: {
          wallet: swap.wallet as string, sourceAssetId: swap.sourceAssetId as string,
          destinationAssetId: swap.destinationAssetId as string, sourceAmountRaw: swap.sourceAmountRaw as string,
          minimumOutputRaw: swap.minimumOutputRaw as string, reportedHash: row.transaction_hash
        } });
      })() : await verifyExpectedEffect(evidence, observed);
      reason = verified.status === "confirmed" || verified.status === "confirmed-source" ? null : verified.reason ?? null;
      state = observed.status === "pending" ? "unindexed" : verified.status === "reorged" ? "check_failed"
        : verified.status === "confirmed" ? "settled"
        : verified.status === "confirmed-source" ? "identity_matched"
        : verified.status === "failed" ? "reverted" : verified.status === "inconsistent"
          ? verified.reason === "reorg" ? "check_failed" : "identity_mismatch" : "identity_matched";
      retainedEvidence = { ...retainedEvidence, verification: verified };
    } catch (error) {
      state = "check_failed";
      reason = error instanceof Error ? error.name : "observation_error";
    }
    const now = new Date().toISOString();
    const statements = [
      db.prepare(`UPDATE intent_observation_candidates SET verification_state = ?, canonical_block_hash = ?, effect_reason = ?, last_checked_at = ?
        WHERE report_id = ? AND subject_reference = ?`).bind(state, blockHash, reason, now, row.report_id, subjectReference),
      db.prepare(`INSERT INTO intent_observation_checks (check_id, report_id, verification_state, reason, canonical_block_hash, evidence_json, checked_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`).bind(crypto.randomUUID(), row.report_id, state, reason, blockHash, JSON.stringify(retainedEvidence), now)
    ];
    if (state === "settled" || state === "identity_mismatch"
      || row.intent_type === "bridge" && state === "identity_matched" && reason === null
      || ["cancelled", "failed"].includes(row.intent_status)) statements.push(
      db.prepare(`INSERT INTO operational_issues (issue_id, subject_reference, issue_type, severity, source_name, source_reference, summary, status, opened_at)
        SELECT ?, ?, ?, 'high', 'late_observation', ?, ?, 'open', ?
        WHERE NOT EXISTS (SELECT 1 FROM operational_issues WHERE source_name = 'late_observation' AND source_reference = ? AND status = 'open')`)
        .bind(crypto.randomUUID(), subjectReference, row.intent_type === "bridge" ? "late_bridge_review" : row.intent_type === "swap" ? "late_swap_review" : "late_transfer_review",
          row.report_id, `Late ${row.intent_type} ${state}; intent ${row.intent_status}`, now, row.report_id));
    await db.batch(statements);
    results.push({ reportId: row.report_id, verificationState: state });
  }
  return results;
}
