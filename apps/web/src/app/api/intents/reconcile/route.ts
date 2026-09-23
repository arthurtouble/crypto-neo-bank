import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { observeTransaction } from "@/lib/transactions/chain-observation";
import { verifyExpectedEffect, type PreparedEffectEvidence } from "@/lib/transactions/effects";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { reconcileLateObservations } from "@/lib/transactions/late-observation";
import { verifySameChainSwapEffect } from "@/lib/swap/source-effect";
import { verifyCrossChainSourceEffect } from "@/lib/swap/cross-source-effect";
import { verifySwapDestination } from "@/lib/swap/destination-evidence";
import { readLifiTransferStatus } from "@/lib/swap/lifi-status";
import { parseAssetId } from "@/lib/swap/assets";

type Intent = { intent_id: string; subject_reference: string; chain_id: number; transaction_hash: string | null; status: string; intent_type: string; route_reference: string | null };
type Step = { intent_id: string; step_index: number; wallet_address: string; chain_id: number; target_address: string; native_value: string; calldata_hash: string; call_fingerprint: string; source_reference: string; semantic_action: string; expected_effect_json: string; reported_hash: string | null; observed_block_hash: string | null; verification_state: string; updated_at: string };
type BridgePlan = { plan_id: string; intent_id: string; subject_reference: string; fingerprint: string; wallet_address: string; recipient: string;
  source_asset_id: string; destination_asset_id: string; source_chain_id: number; destination_chain_id: number;
  from_amount_raw: string; to_amount_min_raw: string; tool_id: string; source_call_json: string };
type DestinationRecord = { intent_id: string; plan_id: string; plan_fingerprint: string; source_hash: string; source_call_fingerprint: string;
  destination_chain_id: number; destination_hash: string | null; observed_block_hash: string | null };
type BridgeEffect = { type: "bridge"; wallet: string; recipient: string; sourceChainId: number; destinationChainId: number;
  sourceAmountRaw: string; bridgeAmountRaw: string; bridgeOutputRaw: string; minimumOutputRaw: string;
  quoteTimestamp: number; fillDeadline: number; sourceAssetId: string; destinationAssetId: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const bridgeEffect = (value: unknown, plan: BridgePlan, intent: Intent, step: Step): BridgeEffect | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const effect = value as Record<string, unknown>;
  if (effect.type !== "bridge" || typeof effect.wallet !== "string" || typeof effect.recipient !== "string"
    || typeof effect.destinationAssetId !== "string" || typeof effect.sourceAmountRaw !== "string"
    || typeof effect.bridgeAmountRaw !== "string" || typeof effect.bridgeOutputRaw !== "string"
    || typeof effect.minimumOutputRaw !== "string" || typeof effect.quoteTimestamp !== "number"
    || typeof effect.fillDeadline !== "number" || effect.sourceChainId !== 8453 || effect.destinationChainId !== 42161
    || plan.source_chain_id !== 8453 || plan.destination_chain_id !== 42161 || plan.tool_id !== "across"
    || !same(effect.wallet, step.wallet_address) || !same(effect.wallet, plan.wallet_address)
    || !same(effect.recipient, plan.recipient) || !same(effect.recipient, effect.wallet)
    || effect.sourceAmountRaw !== plan.from_amount_raw || effect.minimumOutputRaw !== plan.to_amount_min_raw
    || effect.destinationAssetId !== plan.destination_asset_id || effect.sourceAssetId !== plan.source_asset_id
    || intent.route_reference !== `swap-plan:${plan.plan_id}` || step.source_reference !== intent.route_reference
    || plan.intent_id !== intent.intent_id || plan.subject_reference !== intent.subject_reference
    || !/^8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913$/.test(plan.source_asset_id)
    || plan.destination_asset_id !== "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831") return null;
  return effect as BridgeEffect;
};

function reply(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const intents = await env.PROJECTION_DB.prepare(`SELECT intent_id, subject_reference, chain_id, transaction_hash, status, intent_type, route_reference
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
        calldata_hash, call_fingerprint, source_reference, semantic_action, expected_effect_json, reported_hash, observed_block_hash, verification_state, updated_at
        FROM intent_prepared_calls WHERE intent_id = ? ORDER BY step_index`).bind(intent.intent_id).all<Step>();
      if (steps.results.length === 0) {
        results.push({ intentId: intent.intent_id, status: intent.status, verificationState: "unverified_legacy" });
        continue;
      }
      let allConfirmed = true;
      let verificationState = "pending";
      const matchedHashes = new Set<string>();
      let sourceObservation: Awaited<ReturnType<typeof observeTransaction>> | null = null;
      let bridgePlan: BridgePlan | null = null;
      let expectedBridge: BridgeEffect | null = null;
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
          const verification = intent.intent_type === "bridge" && step.semantic_action === "bridge"
            ? await (async () => {
              if (step.step_index !== 0 || steps.results.length !== 1) return { status: "inconsistent" as const, reason: "bridge_steps" };
              bridgePlan = await env.PROJECTION_DB.prepare(`SELECT plan_id, intent_id, subject_reference, fingerprint, wallet_address, recipient,
                source_asset_id, destination_asset_id, source_chain_id, destination_chain_id, from_amount_raw,
                to_amount_min_raw, tool_id, source_call_json FROM swap_quote_plans WHERE intent_id = ? AND subject_reference = ?`)
                .bind(intent.intent_id, subject.subjectReference).first<BridgePlan>();
              if (!bridgePlan || !/^0x[a-f0-9]{64}$/i.test(bridgePlan.fingerprint))
                return { status: "inconsistent" as const, reason: "bridge_plan" };
              expectedBridge = bridgeEffect(expectedEffect, bridgePlan, intent, step);
              if (!expectedBridge) return { status: "inconsistent" as const, reason: "bridge_effect_schema" };
              let prepared;
              try { prepared = await normalizePreparedCall(JSON.parse(bridgePlan.source_call_json)); }
              catch { return { status: "inconsistent" as const, reason: "bridge_plan_call" }; }
              if (prepared.fingerprint !== step.call_fingerprint || prepared.dataHash !== step.calldata_hash
                || prepared.chainId !== step.chain_id || !same(prepared.from, step.wallet_address)
                || !same(prepared.to, step.target_address) || prepared.value !== step.native_value)
                return { status: "inconsistent" as const, reason: "bridge_plan_call" };
              if (step.observed_block_hash && observed.status === "found"
                && !same(step.observed_block_hash, observed.blockHash ?? ""))
                return { status: "reorged" as const, reason: "reorg" };
              sourceObservation = observed;
              return verifyCrossChainSourceEffect({ call: prepared, observed, expected: {
                wallet: expectedBridge.wallet, recipient: expectedBridge.recipient,
                sourceChainId: expectedBridge.sourceChainId, destinationChainId: expectedBridge.destinationChainId,
                sourceAmountRaw: expectedBridge.sourceAmountRaw, bridgeAmountRaw: expectedBridge.bridgeAmountRaw,
                bridgeOutputRaw: expectedBridge.bridgeOutputRaw, minimumOutputRaw: expectedBridge.minimumOutputRaw,
                quoteTimestamp: expectedBridge.quoteTimestamp, fillDeadline: expectedBridge.fillDeadline, reportedHash
              } });
            })()
            : intent.intent_type === "swap" && step.semantic_action === "swap"
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
          if (observed.status === "found"
            && (intent.intent_type !== "bridge" || sourceObservation !== null)
            && !(verification.status === "inconsistent" && ["invalid_transaction", "transaction_identity"].includes(verification.reason ?? "")))
            matchedHashes.add(reportedHash.toLowerCase());
          const stepConfirmed = verification.status === "confirmed" || verification.status === "confirmed-source";
          if (!stepConfirmed) allConfirmed = false;
          if (verification.status === "reorged" || verification.status !== "confirmed" && verification.reason === "reorg") verificationState = "reorged";
          else if (verification.status === "inconsistent" || verification.status === "failed" || verification.status === "partial") verificationState = verification.status;
          await env.PROJECTION_DB.prepare(`UPDATE intent_prepared_calls SET verification_state = ?, observed_block_hash = COALESCE(observed_block_hash, ?), updated_at = ?
            WHERE intent_id = ? AND step_index = ?`).bind("reason" in verification && verification.reason === "reorg" ? "reorged" : stepConfirmed ? "confirmed" : verification.status,
              observed.status === "found" ? observed.blockHash : null, new Date().toISOString(), intent.intent_id, step.step_index).run();
          if (verification.status === "inconsistent" || verification.status === "failed"
            || verification.status === "partial" || verification.status === "reorged") {
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
        let bridgeComplete = false;
        // These are populated during the source-step check above; TypeScript does not track assignments inside that async check.
        const settledBridgePlan = bridgePlan as BridgePlan | null;
        const settledBridgeEffect = expectedBridge as BridgeEffect | null;
        const settledSourceObservation = sourceObservation as Awaited<ReturnType<typeof observeTransaction>> | null;
        if (intent.intent_type === "bridge" && allConfirmed && ["submitted", "confirmed"].includes(intent.status)
          && steps.results.length === 1 && settledBridgePlan && settledBridgeEffect && settledSourceObservation) {
          const sourceStep = steps.results[0];
          const sourceHash = sourceStep.reported_hash!;
          const previous = await env.PROJECTION_DB.prepare(`SELECT intent_id, plan_id, plan_fingerprint, source_hash,
            source_call_fingerprint, destination_chain_id, destination_hash, observed_block_hash
            FROM swap_destination_observations WHERE intent_id = ?`).bind(intent.intent_id).first<DestinationRecord>();
          if (previous && (previous.plan_id !== settledBridgePlan.plan_id || previous.plan_fingerprint !== settledBridgePlan.fingerprint
            || !same(previous.source_hash, sourceHash) || previous.source_call_fingerprint !== sourceStep.call_fingerprint
            || previous.destination_chain_id !== settledBridgeEffect.destinationChainId)) {
            verificationState = "inconsistent";
          } else {
            const provider = await readLifiTransferStatus({ sourceHash, sourceChainId: settledBridgeEffect.sourceChainId,
              destinationChainId: settledBridgeEffect.destinationChainId, toolId: settledBridgePlan.tool_id });
            // Pending and exceptional provider hashes are not immutable destination identities.
            const destinationHash = provider.status === "DONE" && provider.substatus === "COMPLETED"
              ? provider.destinationHash : null;
            if (previous?.destination_hash && destinationHash && !same(previous.destination_hash, destinationHash)) {
              verificationState = "inconsistent";
            } else {
              const destinationObserved = destinationHash
                ? await observeTransaction(settledBridgeEffect.destinationChainId, destinationHash) : { status: "pending" as const };
              const destinationAsset = parseAssetId(settledBridgePlan.destination_asset_id);
              const sourceAsset = parseAssetId(settledBridgePlan.source_asset_id);
              if (!destinationAsset?.address || !sourceAsset?.address) verificationState = "inconsistent";
              else {
                const result = provider.status === "NOT_FOUND"
                  ? { status: "pending" as const, reason: "provider_not_found" }
                  : verifySwapDestination({ expected: { sourceHash, sourceChainId: settledBridgeEffect.sourceChainId,
                    destinationChainId: settledBridgeEffect.destinationChainId, destinationToken: destinationAsset.address,
                    recipient: settledBridgeEffect.recipient, minimumAmountRaw: settledBridgeEffect.minimumOutputRaw,
                    across: { sourceToken: sourceAsset.address, sourceAmountRaw: settledBridgeEffect.bridgeAmountRaw,
                      depositor: settledBridgeEffect.wallet }, previousBlockHash: previous?.observed_block_hash },
                  provider: { ...provider, status: provider.status }, observedHash: destinationHash,
                  sourceObserved: settledSourceObservation, observed: destinationObserved });
                const rawStatus = provider.status === "PARTIAL" || provider.status === "REFUNDED" ? "DONE" : provider.status;
                const providerSubstatus = ["COMPLETED", "PARTIAL", "REFUNDED"].includes(provider.substatus ?? "")
                  ? provider.substatus : null;
                const observedBlockHash = destinationObserved.status === "found" ? destinationObserved.blockHash : null;
                const now = new Date().toISOString();
                if (previous) {
                  await env.PROJECTION_DB.prepare(`UPDATE swap_destination_observations SET provider_status = ?, provider_substatus = ?,
                    verification_state = ?, reason_code = ?, observed_block_hash = COALESCE(observed_block_hash, ?),
                    destination_hash = COALESCE(destination_hash, ?), checked_at = ? WHERE intent_id = ?`)
                    .bind(rawStatus, providerSubstatus, result.status, "reason" in result ? result.reason : null,
                      observedBlockHash, destinationHash, now, intent.intent_id).run();
                } else {
                  await env.PROJECTION_DB.prepare(`INSERT INTO swap_destination_observations (intent_id, subject_reference,
                    plan_id, plan_fingerprint, source_hash, source_call_fingerprint, destination_chain_id,
                    destination_hash, observed_block_hash, provider_status, provider_substatus, verification_state,
                    reason_code, checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                    .bind(intent.intent_id, subject.subjectReference, settledBridgePlan.plan_id, settledBridgePlan.fingerprint,
                      sourceHash.toLowerCase(), sourceStep.call_fingerprint, settledBridgeEffect.destinationChainId,
                      destinationHash?.toLowerCase() ?? null, observedBlockHash, rawStatus, providerSubstatus,
                      result.status, "reason" in result ? result.reason : null, now, now).run();
                }
                bridgeComplete = result.status === "complete";
                verificationState = bridgeComplete ? "confirmed" : result.status;
                if (["inconsistent", "partial", "failed", "refund_reported", "reorged"].includes(result.status)) {
                  await env.PROJECTION_DB.prepare(`INSERT INTO operational_issues
                    (issue_id, subject_reference, issue_type, severity, source_name, source_reference, summary, status, opened_at)
                    SELECT ?, ?, 'settlement_mismatch', 'high', 'bridge_destination', ?, ?, 'open', ?
                    WHERE NOT EXISTS (SELECT 1 FROM operational_issues WHERE source_name = 'bridge_destination' AND source_reference = ? AND status = 'open')`)
                    .bind(crypto.randomUUID(), subject.subjectReference, intent.intent_id,
                      `Destination: ${"reason" in result ? result.reason : result.status}`, now, intent.intent_id).run();
                }
              }
            }
          }
        }
        const swapSettled = intent.intent_type === "swap" && steps.results.length === 1
          && steps.results[0].step_index === 0 && steps.results[0].semantic_action === "swap";
        const settleable = intent.intent_type === "transfer" || swapSettled || intent.intent_type === "bridge" && bridgeComplete;
        if (allConfirmed && settleable) {
          const changed = await env.PROJECTION_DB.prepare(`UPDATE transaction_intents SET status = 'confirmed', confirmed_at = ?, updated_at = ?
            WHERE intent_type = ? AND intent_id = ? AND status IN ('submitted', 'confirmed')
            AND EXISTS (SELECT 1 FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id)
            AND NOT EXISTS (SELECT 1 FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id AND p.verification_state != 'confirmed')
            AND (intent_type = 'transfer' OR (intent_type = 'bridge'
              AND (SELECT COUNT(*) FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id) = 1
              AND EXISTS (SELECT 1 FROM intent_prepared_calls p WHERE p.intent_id = transaction_intents.intent_id
                AND p.step_index = 0 AND p.semantic_action = 'bridge' AND lower(p.reported_hash) = lower(transaction_intents.transaction_hash))
              AND EXISTS (SELECT 1 FROM swap_destination_observations d WHERE d.intent_id = transaction_intents.intent_id
                AND d.verification_state = 'complete' AND lower(d.source_hash) = lower(transaction_intents.transaction_hash)))
              OR (intent_type = 'swap'
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
        if (allConfirmed && !settleable && verificationState === "pending") verificationState = "source_confirmed_pending_settlement";
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
