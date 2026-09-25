import { env } from "cloudflare:workers";
import { createPublicClient, formatUnits, http, isAddress } from "viem";
import { z } from "zod";
import { SUPPORTED_CHAINS } from "@/config/supported-chains";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { requireFeature } from "@/lib/features/flags";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { observeTransaction, observeTransactionIdentity } from "@/lib/transactions/chain-observation";
import { matchesPreparedCall, normalizePreparedCall } from "@/lib/transactions/evidence";
import { observeNextSwapApproval } from "@/lib/swap/approval-steps";
import { verifySwapApprovalEffect } from "@/lib/swap/approval-effect";
import { resolveCatalogAsset } from "@/lib/swap/catalog";
import { isDirectUniswapPlan } from "@/lib/swap/direct-uniswap";
import { getActiveSwapQuotePlan } from "@/lib/swap/plans";
import { assertSwapPrepareIntegrity } from "@/lib/swap/prepare-integrity";
import { evaluateTransactionPolicy } from "@/lib/transactions/policy";
import { valueSwapSource } from "@/lib/transactions/valuation";
import { route } from "@/lib/http/route";

const prepareSchema = z.object({ intentId: z.string().uuid(), planId: z.string().uuid(),
  walletAddress: z.string().refine(isAddress) }).strict();
const recheckSchema = z.object({ approvalId: z.string().uuid(), walletAddress: z.string().refine(isAddress),
  recheck: z.literal(true) }).strict();
const reviewedSchema = z.object({ type: z.enum(["swap", "bridge"]), walletAddress: z.string().refine(isAddress),
  chainId: z.literal(8453), asset: z.string(), amount: z.string(), amountRaw: z.string(),
  destination: z.string().refine(isAddress), destinationChainId: z.union([z.literal(8453), z.literal(42161), z.literal(1)]),
  destinationAssetId: z.string(), toAmountMinRaw: z.string(), planId: z.string().uuid() }).passthrough();
const reportSchema = z.object({ approvalId: z.string().uuid(),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict();
type Intent = { intent_id: string; intent_type: string; wallet_reference: string; status: string;
  expires_at: string; route_reference: string | null; policy_result_json: string; request_json: string };
type Profile = { account_locked: number; enforce_address_book: number; daily_limit_usd: number;
  new_address_threshold_usd: number; step_up_threshold_usd: number; new_address_delay_seconds: number; policy_version: number };
type Approval = { approval_id: string; subject_reference: string; wallet_address: string; token_address: string;
  intent_id: string; plan_id: string;
  spender_address: string; amount_raw: string; call_json: string; call_fingerprint: string;
  status: string; transaction_hash: string | null; expires_at: string };

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Prepare one exact approval, independently of the swap intent. It is not swap signing authority. */
export const POST = route("swap.approval.prepare", { unavailable: "approval_unavailable", invalid: "invalid_approval" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await requireFeature(env.PROJECTION_DB, "swaps");
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_approval_prepare", subject: subject.subjectReference,
    limit: 12, windowSeconds: 600 });
  const raw = await request.json();
  const recheckInput = recheckSchema.safeParse(raw);
  const rechecking = recheckInput.success;
  const input = recheckInput.success ? recheckInput.data : prepareSchema.parse(raw);
  const wallet = await requireLinkedEvmWallet(subject.subjectReference, input.walletAddress);
  const now = new Date();
  const approval = recheckInput.success ? await env.PROJECTION_DB.prepare(`SELECT * FROM swap_approval_requests
    WHERE approval_id = ? AND subject_reference = ?`).bind(recheckInput.data.approvalId, subject.subjectReference).first<Approval>() : null;
  if (rechecking && (!approval || approval.wallet_address !== wallet || approval.status !== "prepared"
    || approval.transaction_hash || approval.expires_at <= now.toISOString()))
    return reply({ error: "approval_conflict", traceId }, 409);
  const activePlanId = rechecking ? approval!.plan_id : "planId" in input ? input.planId : "";
  const activeIntentId = rechecking ? approval!.intent_id : "intentId" in input ? input.intentId : "";
  const [plan, intent, prior] = await Promise.all([
    getActiveSwapQuotePlan(env.PROJECTION_DB, activePlanId, subject.subjectReference, wallet, now.getTime()),
    env.PROJECTION_DB.prepare(`SELECT intent_id, intent_type, wallet_reference, status, expires_at,
      route_reference, policy_result_json, request_json
      FROM transaction_intents WHERE intent_id = ? AND subject_reference = ?`)
      .bind(activeIntentId, subject.subjectReference).first<Intent>(),
    rechecking ? Promise.resolve(null) : env.PROJECTION_DB.prepare("SELECT approval_id FROM swap_approval_requests WHERE plan_id = ?")
      .bind(activePlanId).first<{ approval_id: string }>()
  ]);
  if (prior) return reply({ error: "approval_already_prepared", traceId }, 409);
  const bridge = plan?.tool_id === "across" && plan.source_chain_id === 8453
    && [1, 42161].includes(plan.destination_chain_id)
    && plan.source_asset_id === "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
    && plan.destination_asset_id === (plan.destination_chain_id === 1
      ? "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
      : "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831");
  if (!plan || !(isDirectUniswapPlan(plan) || bridge) || plan.intent_id !== activeIntentId
    || !intent || intent.intent_type !== (bridge ? "bridge" : "swap") || intent.status !== "reviewed"
    || intent.wallet_reference !== `wallet:${wallet}` || intent.expires_at <= now.toISOString()
    || intent.route_reference !== `swap-plan:${plan.plan_id}`
    || z.object({ permitted: z.literal(true) }).passthrough().safeParse(JSON.parse(intent.policy_result_json)).success === false)
    return reply({ error: "review_mismatch", traceId }, 409);
  if (bridge) await requireFeature(env.PROJECTION_DB, "cross_chain");
  const [from, to] = await Promise.all([resolveCatalogAsset(plan.source_asset_id), resolveCatalogAsset(plan.destination_asset_id)]);
  if (!from || !to) return reply({ error: "route_unavailable", traceId }, 422);
  let governed;
  try { governed = await assertSwapPrepareIntegrity(plan, { from, to }, now.getTime()); }
  catch { return reply({ error: "route_unavailable", traceId }, 422); }
  const chain = SUPPORTED_CHAINS.find(({ id }) => id === 8453);
  if (!chain) return reply({ error: "route_unavailable", traceId }, 422);
  const client = createPublicClient({ transport: http(chain.rpcUrls.default.http[0]) });
  const observed = await observeNextSwapApproval(client, { plan: {
    fromAssetId: plan.source_asset_id, fromChainId: 8453, fromAmountRaw: plan.from_amount_raw,
    approvalSpender: plan.approval_spender, sourceCall: governed.sourceCall
  }, wallet, reviewedSpender: governed.reviewedSpender, nowMs: now.getTime(), maxAgeMs: 120_000 });
  if (observed.kind === "sufficient") return reply({ error: "approval_already_sufficient", traceId }, 409);
  const call = await normalizePreparedCall(observed.step);
  const at = new Date().toISOString();
  if (plan.expires_at <= at || intent.expires_at <= at) return reply({ error: "quote_expired", traceId }, 409);
  if (rechecking) {
    const original = await normalizePreparedCall(JSON.parse(approval!.call_json));
    if (approval!.expires_at <= at || approval!.call_fingerprint !== original.fingerprint
      || approval!.call_fingerprint !== call.fingerprint || original.from !== call.from
      || original.to !== call.to || original.value !== call.value || original.data !== call.data
      || approval!.token_address !== call.to.toLowerCase()
      || approval!.spender_address !== observed.step.spender.toLowerCase()
      || approval!.amount_raw !== observed.step.amountRaw)
      return reply({ error: "approval_conflict", traceId }, 409);
    const reviewed = reviewedSchema.safeParse(JSON.parse(intent.request_json));
    if (!reviewed.success || reviewed.data.type !== intent.intent_type || reviewed.data.planId !== plan.plan_id
      || reviewed.data.walletAddress.toLowerCase() !== wallet || reviewed.data.destination.toLowerCase() !== wallet
      || reviewed.data.asset !== plan.source_asset_id || reviewed.data.amountRaw !== plan.from_amount_raw
      || reviewed.data.amount !== formatUnits(BigInt(plan.from_amount_raw), from.decimals)
      || reviewed.data.destinationChainId !== plan.destination_chain_id
      || reviewed.data.destinationAssetId !== plan.destination_asset_id
      || reviewed.data.toAmountMinRaw !== plan.to_amount_min_raw)
      return reply({ error: "review_mismatch", traceId }, 409);
    const valuation = await valueSwapSource({ assetId: plan.source_asset_id, amountRaw: plan.from_amount_raw }, { now: new Date(at) });
    if (valuation.decimals !== from.decimals || valuation.rawUnits !== plan.from_amount_raw)
      return reply({ error: "review_mismatch", traceId }, 409);
    const rollingStart = new Date(Date.parse(at) - 86_400_000).toISOString();
    const [profile, spending] = await Promise.all([
      env.PROJECTION_DB.prepare(`SELECT account_locked, enforce_address_book, daily_limit_usd,
        new_address_threshold_usd, step_up_threshold_usd, new_address_delay_seconds, policy_version
        FROM security_profiles WHERE subject_reference = ?`)
        .bind(subject.subjectReference).first<Profile>(),
      env.PROJECTION_DB.prepare(`SELECT COALESCE(SUM(CAST(v.usd_cents AS INTEGER)), 0) AS spent_cents,
        SUM(CASE WHEN v.valuation_id IS NULL THEN 1 ELSE 0 END) AS missing
        FROM transaction_intents i LEFT JOIN intent_valuations v ON v.rowid =
          (SELECT MAX(v2.rowid) FROM intent_valuations v2 WHERE v2.intent_id = i.intent_id)
        WHERE i.subject_reference = ? AND i.intent_id != ?
          AND (i.created_at >= ? OR EXISTS (SELECT 1 FROM intent_prepared_calls recent
            WHERE recent.intent_id = i.intent_id AND recent.created_at >= ?))
          AND (i.status IN ('submitted', 'confirmed') OR EXISTS (
            SELECT 1 FROM intent_prepared_calls p WHERE p.intent_id = i.intent_id
              AND p.expires_at > ? AND p.verification_state != 'failed'))`)
        .bind(subject.subjectReference, intent.intent_id, rollingStart, rollingStart, at)
        .first<{ spent_cents: number; missing: number }>()
    ]);
    if (!profile || profile.account_locked || !Number.isSafeInteger(profile.policy_version) || profile.policy_version < 1)
      return reply({ error: "policy_not_permitted", traceId }, 403);
    const spentCents = spending?.spent_cents ?? 0;
    const valuedCents = Number(valuation.usdCents);
    const limitCents = Math.floor(profile.daily_limit_usd * 100);
    if (Boolean(spending?.missing) || !Number.isSafeInteger(spentCents) || spentCents < 0
      || !Number.isSafeInteger(valuedCents) || valuedCents <= 0
      || !Number.isSafeInteger(limitCents) || limitCents < 0)
      return reply({ error: "spent_value_unavailable", traceId }, 403);
    const decision = evaluateTransactionPolicy(reviewed.data, { supportedChainIds: [8453],
      allowlistedDestinations: [], coolingDestinations: [], enforceAllowlist: Boolean(profile.enforce_address_book),
      accountLocked: false, reserveFloorUsd: 10_000,
      dailyLimitUsd: profile.daily_limit_usd, spentTodayUsd: spentCents / 100,
      newAddressThresholdUsd: profile.new_address_threshold_usd,
      stepUpThresholdUsd: profile.step_up_threshold_usd, delayThresholdUsd: 25_000,
      delaySeconds: profile.new_address_delay_seconds }, new Date(at), valuation.usdCents);
    if (!decision.permitted || decision.releaseAt || decision.requiresStepUp)
      return reply({ error: "policy_not_permitted", traceId }, 403);
    // The final read is the signing gate, after the network allowance observation.
    const current = await env.PROJECTION_DB.prepare(`SELECT a.approval_id FROM swap_approval_requests a
      JOIN swap_quote_plans p ON p.plan_id = a.plan_id
      JOIN transaction_intents i ON i.intent_id = a.intent_id
      JOIN security_profiles s ON s.subject_reference = a.subject_reference AND s.account_locked = 0
        AND s.policy_version = ?
      JOIN feature_flags f ON f.flag_key = 'swaps' AND f.enabled = 1 AND f.audience = 'all'
      WHERE a.approval_id = ? AND a.subject_reference = ? AND a.wallet_address = ?
        AND a.plan_id = ? AND a.intent_id = ? AND a.status = 'prepared' AND a.transaction_hash IS NULL
        AND a.expires_at = ? AND a.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND a.call_json = ? AND a.call_fingerprint = ? AND a.token_address = ?
        AND a.spender_address = ? AND a.amount_raw = ?
        AND p.subject_reference = a.subject_reference AND p.wallet_address = a.wallet_address
        AND p.intent_id = i.intent_id AND p.status = 'active' AND p.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND i.subject_reference = a.subject_reference AND i.wallet_reference = 'wallet:' || a.wallet_address
        AND i.status = 'reviewed' AND i.chain_id = 8453
        AND i.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND i.route_reference = 'swap-plan:' || p.plan_id AND json_extract(i.policy_result_json, '$.permitted') = 1
        AND p.approval_spender = a.spender_address AND (p.from_amount_raw = a.amount_raw OR a.amount_raw = '0')
        AND EXISTS (SELECT 1 FROM (
          SELECT COALESCE(SUM(CAST(v.usd_cents AS INTEGER)), 0) AS cents,
            COALESCE(SUM(CASE WHEN v.valuation_id IS NULL THEN 1 ELSE 0 END), 0) AS missing
          FROM transaction_intents spending LEFT JOIN intent_valuations v ON v.rowid =
            (SELECT MAX(v2.rowid) FROM intent_valuations v2 WHERE v2.intent_id = spending.intent_id)
          WHERE spending.subject_reference = ? AND spending.intent_id != ?
            AND (spending.created_at >= ? OR EXISTS (SELECT 1 FROM intent_prepared_calls recent
              WHERE recent.intent_id = spending.intent_id AND recent.created_at >= ?))
            AND (spending.status IN ('submitted', 'confirmed') OR EXISTS (
              SELECT 1 FROM intent_prepared_calls reserved_call WHERE reserved_call.intent_id = spending.intent_id
                AND reserved_call.expires_at > ? AND reserved_call.verification_state != 'failed'))
        ) reserved WHERE reserved.missing = 0 AND reserved.cents + ? <=
          CAST(s.daily_limit_usd * 100 AS INTEGER))
        AND ((i.intent_type = 'swap' AND p.tool_id = 'uniswap_v3_direct' AND p.destination_chain_id = 8453)
          OR (i.intent_type = 'bridge' AND p.tool_id = 'across' AND p.destination_chain_id IN (1, 42161)
            AND p.recipient = p.wallet_address
            AND EXISTS (SELECT 1 FROM feature_flags c WHERE c.flag_key = 'cross_chain'
              AND c.enabled = 1 AND c.audience = 'all')))`)
      .bind(profile.policy_version, approval!.approval_id, subject.subjectReference, wallet,
        plan.plan_id, intent.intent_id, approval!.expires_at, approval!.call_json,
        call.fingerprint, call.to.toLowerCase(), observed.step.spender.toLowerCase(), observed.step.amountRaw,
        subject.subjectReference, intent.intent_id, rollingStart, rollingStart, at, valuedCents)
      .first<{ approval_id: string }>();
    if (!current) return reply({ error: "approval_conflict", traceId }, 409);
    return reply({ approvalId: approval!.approval_id, kind: observed.kind, amountRaw: observed.step.amountRaw,
      spender: observed.step.spender, fingerprint: call.fingerprint,
      call: { chainId: call.chainId, from: call.from, to: call.to, value: call.value, data: call.data },
      expiresAt: approval!.expires_at, traceId });
  }
  const approvalId = crypto.randomUUID();
  // This is approval for this reviewed trade, not standing router consent.
  const expiresAt = new Date(Math.min(Date.parse(plan.expires_at), Date.parse(intent.expires_at))).toISOString();
  const inserted = await env.PROJECTION_DB.prepare(`INSERT INTO swap_approval_requests
    (approval_id, subject_reference, wallet_address, intent_id, plan_id, token_address,
     spender_address, amount_raw, call_json, call_fingerprint, status, expires_at, created_at, updated_at)
    SELECT ?, i.subject_reference, p.wallet_address, i.intent_id, p.plan_id, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?
    FROM swap_quote_plans p JOIN transaction_intents i ON i.intent_id = p.intent_id
    JOIN security_profiles s ON s.subject_reference = i.subject_reference AND s.account_locked = 0
    JOIN feature_flags f ON f.flag_key = 'swaps' AND f.enabled = 1 AND f.audience = 'all'
    WHERE p.plan_id = ? AND i.intent_id = ? AND p.subject_reference = ? AND p.wallet_address = ?
      AND p.status = 'active' AND i.status = 'reviewed' AND i.chain_id = 8453
      AND p.source_chain_id = 8453
      AND ((i.intent_type = 'swap' AND p.tool_id = 'uniswap_v3_direct' AND p.destination_chain_id = 8453)
        OR (i.intent_type = 'bridge' AND p.tool_id = 'across' AND p.destination_chain_id IN (1, 42161)
          AND p.source_asset_id = '8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
          AND ((p.destination_chain_id = 1 AND p.destination_asset_id = '1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
            OR (p.destination_chain_id = 42161 AND p.destination_asset_id = '42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831'))
          AND p.recipient = p.wallet_address
          AND EXISTS (SELECT 1 FROM feature_flags cross_chain WHERE cross_chain.flag_key = 'cross_chain'
            AND cross_chain.enabled = 1 AND cross_chain.audience = 'all')))
      AND i.route_reference = 'swap-plan:' || p.plan_id
      AND json_extract(i.policy_result_json, '$.permitted') = 1
      AND p.expires_at > ? AND p.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND i.expires_at > ? AND i.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND p.approval_spender = ? AND (p.from_amount_raw = ? OR ? = '0')
      AND NOT EXISTS (SELECT 1 FROM swap_approval_requests prior WHERE prior.plan_id = p.plan_id)`)
    .bind(approvalId, call.to.toLowerCase(), observed.step.spender.toLowerCase(), observed.step.amountRaw,
      JSON.stringify({ chainId: call.chainId, from: call.from, to: call.to, value: call.value, data: call.data }),
      call.fingerprint, expiresAt, at, at, plan.plan_id, intent.intent_id,
      subject.subjectReference, wallet, at, at, observed.step.spender.toLowerCase(),
      observed.step.amountRaw, observed.step.amountRaw).run();
  if (inserted.meta.changes !== 1) return reply({ error: "approval_conflict", traceId }, 409);
  return reply({ approvalId, kind: observed.kind, amountRaw: observed.step.amountRaw,
    spender: observed.step.spender, fingerprint: call.fingerprint,
    call: { chainId: call.chainId, from: call.from, to: call.to, value: call.value, data: call.data },
    expiresAt, traceId }, 201);
});

async function ownedApproval(request: Request, approvalId: string): Promise<Approval | null> {
  const subject = await requireVerifiedSubject(request);
  return env.PROJECTION_DB.prepare("SELECT * FROM swap_approval_requests WHERE approval_id = ? AND subject_reference = ?")
    .bind(approvalId, subject.subjectReference).first<Approval>();
}

/** A late hash is observation only; it cannot renew the approval or swap review. */
export const PATCH = route("swap.approval.report", { unavailable: "report_unavailable", invalid: "invalid_report" }, async (request: Request, { traceId }) => {
  const input = reportSchema.parse(await request.json());
  const approval = await ownedApproval(request, input.approvalId);
  if (!approval) return reply({ error: "approval_not_found", traceId }, 404);
  const hash = input.transactionHash.toLowerCase();
  if (approval.transaction_hash && approval.transaction_hash.toLowerCase() !== hash)
    return reply({ error: "hash_conflict", traceId }, 409);
  if (approval.status === "confirmed" || approval.status === "failed" || approval.status === "inconsistent")
    return reply({ status: approval.status, traceId });
  const call = await normalizePreparedCall(JSON.parse(approval.call_json));
  if (call.fingerprint !== approval.call_fingerprint) return reply({ error: "approval_integrity", traceId }, 409);
  const observed = await observeTransactionIdentity(8453, hash);
  if (observed.status === "found" && !(await matchesPreparedCall(call, observed.call)).matches)
    return reply({ error: "transaction_mismatch", traceId }, 409);
  const now = new Date().toISOString();
  const status = observed.status === "found" ? "submitted" : "prepared";
  const saved = await env.PROJECTION_DB.prepare(`UPDATE swap_approval_requests
    SET transaction_hash = ?, status = ?, updated_at = ?
    WHERE approval_id = ? AND subject_reference = ? AND status IN ('prepared', 'submitted')
      AND (transaction_hash IS NULL OR transaction_hash = ?)`) // No signing gate here: observe a broadcast hash even after expiry.
    .bind(hash, status, now, approval.approval_id, approval.subject_reference, hash).run();
  if (saved.meta.changes !== 1) return reply({ error: "approval_conflict", traceId }, 409);
  return reply({ status: observed.status === "found" ? "submitted" : "pending", traceId }, observed.status === "found" ? 200 : 202);
});

export const GET = route("swap.approval.status", { unavailable: "status_unavailable" }, async (request: Request, { traceId }) => {
  const approvalId = new URL(request.url).searchParams.get("approvalId");
  if (!approvalId || !z.string().uuid().safeParse(approvalId).success)
    return reply({ error: "invalid_approval", traceId }, 400);
  const approval = await ownedApproval(request, approvalId);
  if (!approval) return reply({ error: "approval_not_found", traceId }, 404);
  if (!approval.transaction_hash) return reply({ status: "prepared", expiresAt: approval.expires_at, traceId });
  if (["confirmed", "failed", "inconsistent"].includes(approval.status))
    return reply({ status: approval.status, transactionHash: approval.transaction_hash, traceId });
  const call = await normalizePreparedCall(JSON.parse(approval.call_json));
  if (call.fingerprint !== approval.call_fingerprint) return reply({ error: "approval_integrity", traceId }, 409);
  const observed = await observeTransaction(8453, approval.transaction_hash);
  const result = await verifySwapApprovalEffect({ call, observed, expected: {
    wallet: approval.wallet_address, token: approval.token_address, spender: approval.spender_address,
    amountRaw: approval.amount_raw, reportedHash: approval.transaction_hash } });
  if (["confirmed", "failed", "inconsistent"].includes(result.status)) {
    await env.PROJECTION_DB.prepare(`UPDATE swap_approval_requests SET status = ?, updated_at = ?
      WHERE approval_id = ? AND subject_reference = ? AND transaction_hash = ?
        AND status IN ('prepared', 'submitted')`)
      .bind(result.status, new Date().toISOString(), approval.approval_id,
        approval.subject_reference, approval.transaction_hash).run();
  }
  return reply({ status: result.status, reason: result.reason,
    transactionHash: approval.transaction_hash, traceId });
});
