import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { observeTransaction } from "@/lib/transactions/chain-observation";
import { verifyExpectedEffect, type PreparedEffectEvidence } from "@/lib/transactions/effects";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { reconcileLateObservations } from "@/lib/transactions/late-observation";
import { verifySameChainSwapEffect } from "@/lib/swap/source-effect";

type Intent = { intent_id: string; subject_reference: string; chain_id: number; transaction_hash: string | null; status: string; intent_type: string };
type Step = { intent_id: string; step_index: number; wallet_address: string; chain_id: number; target_address: string; native_value: string; calldata_hash: string; semantic_action: string; expected_effect_json: string; reported_hash: string | null; observed_block_hash: string | null; verification_state: string; updated_at: string };

function reply(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const intents = await env.PROJECTION_DB.prepare(`SELECT intent_id, subject_reference, chain_id, transaction_hash, status, intent_type
      FROM transaction_intents WHERE subject_reference = ? AND (
        (status IN ('submitted', 'confirmed') AND transaction_hash IS NOT NULL)
        OR (status = 'reviewed' AND EXISTS (SELECT 1 FROM intent_prepared_calls reported
          WHERE reported.intent_id = transaction_intents.intent_id AND reported.reported_hash IS NOT NULL))
      ) ORDER BY
        CASE WHEN EXISTS (SELECT 1 FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id AND p.reported_hash IS NOT NULL) THEN 0 ELSE 1 END,
        COALESCE((SELECT MAX(p.updated_at) FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id AND p.reported_hash IS NOT NULL), transaction_intents.updated_at) ASC,
        transaction_intents.intent_id ASC LIMIT 20`).bind(subject.subjectReference).all<Intent>();
    const results: Array<Record<string, unknown>> = [];
    for (const intent of intents.results) {
      const steps = await env.PROJECTION_DB.prepare(`SELECT intent_id, step_index, wallet_address, chain_id, target_address, native_value,
        calldata_hash, semantic_action, expected_effect_json, reported_hash, observed_block_hash, verification_state, updated_at
        FROM intent_prepared_calls WHERE intent_id = ? ORDER BY step_index`).bind(intent.intent_id).all<Step>();
      if (steps.results.length === 0) {
        results.push({ intentId: intent.intent_id, status: intent.status, verificationState: "unverified_legacy" });
        continue;
      }
      let allConfirmed = true;
      let verificationState = "pending";
      const matchedHashes = new Set<string>();
      try {
        for (const step of steps.results) {
          if (!step.reported_hash) { allConfirmed = false; continue; }
          const reportedHash = step.reported_hash;
          const observed = await observeTransaction(step.chain_id, reportedHash);
          let expectedEffect: unknown;
          try { expectedEffect = JSON.parse(step.expected_effect_json); }
          catch { expectedEffect = null; }
          const evidence: PreparedEffectEvidence = {
            chainId: step.chain_id, walletAddress: step.wallet_address, targetAddress: step.target_address,
            nativeValue: step.native_value, calldataHash: step.calldata_hash, semanticAction: step.semantic_action,
            expectedEffect, reportedHash: step.reported_hash, observedBlockHash: step.observed_block_hash
          };
          const verification = intent.intent_type === "swap" && step.semantic_action === "swap"
            ? await (async () => {
              if (observed.status === "pending") return { status: "pending" as const, reason: "transaction_unavailable" };
              let call;
              try { call = await normalizePreparedCall(observed.call); }
              catch { return { status: "inconsistent" as const, reason: "invalid_transaction" }; }
              if (call.chainId !== step.chain_id || call.from.toLowerCase() !== step.wallet_address.toLowerCase()
                || call.to.toLowerCase() !== step.target_address.toLowerCase() || call.value !== step.native_value
                || call.dataHash.toLowerCase() !== step.calldata_hash.toLowerCase())
                return { status: "inconsistent" as const, reason: "transaction_identity" };
              if (step.observed_block_hash && step.observed_block_hash.toLowerCase() !== observed.blockHash?.toLowerCase())
                return { status: "reorged" as const, reason: "reorg" };
              if (!expectedEffect || typeof expectedEffect !== "object" || Array.isArray(expectedEffect))
                return { status: "inconsistent" as const, reason: "effect_schema" };
              const swap = expectedEffect as Record<string, unknown>;
              if (swap.type !== "swap" || ["wallet", "sourceAssetId", "destinationAssetId", "sourceAmountRaw", "minimumOutputRaw"]
                .some((field) => typeof swap[field] !== "string"))
                return { status: "inconsistent" as const, reason: "effect_schema" };
              return verifySameChainSwapEffect({ call, observed, expected: {
                wallet: swap.wallet as string, sourceAssetId: swap.sourceAssetId as string,
                destinationAssetId: swap.destinationAssetId as string,
                sourceAmountRaw: swap.sourceAmountRaw as string, minimumOutputRaw: swap.minimumOutputRaw as string,
                reportedHash
              } });
            })()
            : await verifyExpectedEffect(evidence, observed);
          if (observed.status === "found" && !(verification.status === "inconsistent" && ["invalid_transaction", "transaction_identity"].includes(verification.reason ?? ""))) matchedHashes.add(reportedHash.toLowerCase());
          if (verification.status !== "confirmed") allConfirmed = false;
          if (verification.status === "reorged" || verification.status !== "confirmed" && verification.reason === "reorg") verificationState = "reorged";
          else if (verification.status === "inconsistent" || verification.status === "failed" || verification.status === "partial") verificationState = verification.status;
          await env.PROJECTION_DB.prepare(`UPDATE intent_prepared_calls SET verification_state = ?, observed_block_hash = COALESCE(observed_block_hash, ?), updated_at = ?
            WHERE intent_id = ? AND step_index = ?`).bind("reason" in verification && verification.reason === "reorg" ? "reorged" : verification.status,
              observed.status === "found" ? observed.blockHash : null, new Date().toISOString(), intent.intent_id, step.step_index).run();
          if (verification.status === "inconsistent" || verification.status === "failed" || verification.status === "partial") {
            await env.PROJECTION_DB.prepare(`INSERT INTO operational_issues
              (issue_id, subject_reference, issue_type, severity, source_name, source_reference, summary, status, opened_at)
              SELECT ?, ?, 'settlement_mismatch', 'high', 'intent_reconcile', ?, ?, 'open', ?
              WHERE NOT EXISTS (SELECT 1 FROM operational_issues WHERE source_name = 'intent_reconcile' AND source_reference = ? AND status = 'open')`)
              .bind(crypto.randomUUID(), subject.subjectReference, `${intent.intent_id}:${step.step_index}`,
                `Step ${step.step_index}: ${verification.reason}`, new Date().toISOString(), `${intent.intent_id}:${step.step_index}`).run();
          }
        }
        const lastReported = [...steps.results].reverse().find((step) => step.reported_hash)?.reported_hash;
        if (lastReported && matchedHashes.has(lastReported.toLowerCase()) && lastReported.toLowerCase() !== intent.transaction_hash?.toLowerCase() && ["reviewed", "submitted"].includes(intent.status)) {
          const bound = await env.PROJECTION_DB.prepare(`UPDATE transaction_intents SET status = 'submitted', transaction_hash = ?, updated_at = ?
            WHERE intent_id = ? AND subject_reference = ? AND ((status = 'reviewed' AND transaction_hash IS NULL)
              OR (status = 'submitted' AND lower(transaction_hash) = lower(?)))
            AND EXISTS (SELECT 1 FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id AND lower(p.reported_hash) = lower(?))`)
            .bind(lastReported.toLowerCase(), new Date().toISOString(), intent.intent_id, subject.subjectReference, intent.transaction_hash, lastReported).run();
          if (bound.meta.changes === 1) {
            intent.status = "submitted";
            intent.transaction_hash = lastReported.toLowerCase();
          } else allConfirmed = false;
        }
        if (!intent.transaction_hash || lastReported?.toLowerCase() !== intent.transaction_hash.toLowerCase()) {
          allConfirmed = false;
          if (lastReported && matchedHashes.has(lastReported.toLowerCase())) verificationState = "inconsistent";
        }
        const swapSettled = intent.intent_type === "swap" && steps.results.length === 1
          && steps.results[0].step_index === 0 && steps.results[0].semantic_action === "swap";
        const settleable = intent.intent_type === "transfer" || swapSettled;
        if (allConfirmed && settleable) {
          const changed = await env.PROJECTION_DB.prepare(`UPDATE transaction_intents SET status = 'confirmed', confirmed_at = ?, updated_at = ?
            WHERE intent_type = ? AND intent_id = ? AND status IN ('submitted', 'confirmed')
            AND EXISTS (SELECT 1 FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id)
            AND NOT EXISTS (SELECT 1 FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id AND p.verification_state != 'confirmed')
            AND (intent_type = 'transfer' OR (intent_type = 'swap'
              AND (SELECT COUNT(*) FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id) = 1
              AND EXISTS (SELECT 1 FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id
                AND p.step_index = 0 AND p.semantic_action = 'swap')))`)
            .bind(new Date().toISOString(), new Date().toISOString(), intent.intent_type, intent.intent_id).run();
          if (changed.meta.changes === 1) {
            verificationState = "confirmed";
            if (intent.status !== "confirmed") await env.PROJECTION_DB.prepare(`INSERT INTO intent_events (event_id, intent_id, subject_reference, event_type, evidence_json, occurred_at)
              VALUES (?, ?, ?, 'settlement_confirmed', ?, ?)`).bind(crypto.randomUUID(), intent.intent_id, subject.subjectReference,
                JSON.stringify({ preparedSteps: steps.results.length }), new Date().toISOString()).run();
            intent.status = "confirmed";
          } else allConfirmed = false;
        }
        if (allConfirmed && !settleable) verificationState = "source_confirmed_pending_settlement";
        if ((!allConfirmed || !settleable) && intent.status === "confirmed") {
          const downgraded = await env.PROJECTION_DB.prepare(`UPDATE transaction_intents SET status = 'submitted', confirmed_at = NULL, updated_at = ? WHERE intent_id = ? AND status = 'confirmed'`)
            .bind(new Date().toISOString(), intent.intent_id).run();
          if (downgraded.meta.changes === 1) intent.status = "submitted";
        }
        results.push({ intentId: intent.intent_id, status: allConfirmed && settleable ? "confirmed" : intent.status, verificationState });
      } catch (error) {
        console.error(JSON.stringify({ level: "error", event: "intent.reconcile.failed", intentId: intent.intent_id, message: error instanceof Error ? error.message : "unknown" }));
        const lastCheck = steps.results.reduce((latest, step) => step.reported_hash ? Math.max(latest, Date.parse(step.updated_at) || 0) : latest, 0);
        const retryAt = new Date(Math.max(Date.now(), lastCheck + 1)).toISOString();
        await env.PROJECTION_DB.prepare(`UPDATE intent_prepared_calls SET updated_at = ?
          WHERE intent_id = ? AND subject_reference = ? AND reported_hash IS NOT NULL`)
          .bind(retryAt, intent.intent_id, subject.subjectReference).run();
        if (intent.status === "confirmed") {
          const downgraded = await env.PROJECTION_DB.prepare(`UPDATE transaction_intents SET status = 'submitted', confirmed_at = NULL, updated_at = ? WHERE intent_id = ? AND status = 'confirmed'`)
            .bind(new Date().toISOString(), intent.intent_id).run();
          if (downgraded.meta.changes === 1) intent.status = "submitted";
        }
        results.push({ intentId: intent.intent_id, status: intent.status, verificationState: "check_failed" });
      }
    }
    const observations = await reconcileLateObservations(env.PROJECTION_DB, subject.subjectReference);
    return reply({ results, observations }, 200);
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized" }, 401);
    return reply({ error: "reconcile_unavailable" }, 503);
  }
}
