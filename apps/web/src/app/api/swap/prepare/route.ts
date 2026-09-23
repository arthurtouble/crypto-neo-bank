import { env } from "cloudflare:workers";
import { createPublicClient, formatUnits, http, isAddress } from "viem";
import { z } from "zod";
import { SUPPORTED_CHAINS } from "@/config/supported-chains";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { BetaAccessError, configuredCountries, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, requireFeature } from "@/lib/features/flags";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { resolveCatalogAsset } from "@/lib/swap/catalog";
import { observeNextSwapApproval } from "@/lib/swap/approval-steps";
import { getActiveSwapQuotePlan } from "@/lib/swap/plans";
import { assertSwapPrepareIntegrity } from "@/lib/swap/prepare-integrity";
import { observeSwapSourceBalance } from "@/lib/swap/source-balance";
import { observeSwapExecutionBudget } from "@/lib/swap/simulation";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { evaluateTransactionPolicy } from "@/lib/transactions/policy";
import { ValuationError, valueSwapSource } from "@/lib/transactions/valuation";

const inputSchema = z.object({ intentId: z.string().uuid(), planId: z.string().uuid(),
  walletAddress: z.string().refine(isAddress) }).strict();
const reviewedSchema = z.object({ type: z.literal("swap"), walletAddress: z.string().refine(isAddress),
  chainId: z.literal(8453), asset: z.string(), amount: z.string(), amountRaw: z.string(),
  destination: z.string().refine(isAddress), destinationChainId: z.literal(8453),
  destinationAssetId: z.string(), toAmountMinRaw: z.string(), planId: z.string().uuid() }).passthrough();
type Intent = { intent_id: string; intent_type: string; chain_id: number; wallet_reference: string;
  route_reference: string | null; request_json: string; policy_result_json: string; status: string; expires_at: string };
type Profile = { account_locked: number; enforce_address_book: number; daily_limit_usd: number;
  new_address_threshold_usd: number; step_up_threshold_usd: number; new_address_delay_seconds: number };

function reply(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const beta = await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    const countries = configuredCountries();
    if (beta.mode !== "invite" || beta.status !== "active" || !beta.countryCode
      || !countries.includes(beta.countryCode)) return reply({ error: "access_unavailable", traceId }, 403);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_prepare", subject: subject.subjectReference, limit: 20, windowSeconds: 600 });
    const input = inputSchema.parse(await request.json());
    const wallet = await requireLinkedEvmWallet(subject.subjectReference, input.walletAddress);
    await requireFeature(env.PROJECTION_DB, "swaps");
    const now = new Date();
    const [intent, plan] = await Promise.all([
      env.PROJECTION_DB.prepare(`SELECT intent_id, intent_type, chain_id, wallet_reference, route_reference,
        request_json, policy_result_json, status, expires_at FROM transaction_intents
        WHERE intent_id = ? AND subject_reference = ?`).bind(input.intentId, subject.subjectReference).first<Intent>(),
      getActiveSwapQuotePlan(env.PROJECTION_DB, input.planId, subject.subjectReference, wallet, now.getTime())
    ]);
    if (!intent || !plan || plan.intent_id !== input.intentId || intent.intent_type !== "swap"
      || intent.chain_id !== 8453 || plan.source_chain_id !== 8453 || plan.destination_chain_id !== 8453
      || intent.wallet_reference !== `wallet:${wallet}` || intent.route_reference !== `swap-plan:${plan.plan_id}`
      || intent.status !== "reviewed" || intent.expires_at <= now.toISOString())
      return reply({ error: "review_mismatch", traceId }, 409);
    const reviewed = reviewedSchema.safeParse(JSON.parse(intent.request_json));
    const policy = z.object({ permitted: z.literal(true) }).passthrough().safeParse(JSON.parse(intent.policy_result_json));
    if (!reviewed.success || !policy.success || reviewed.data.planId !== plan.plan_id
      || reviewed.data.walletAddress.toLowerCase() !== wallet || reviewed.data.destination.toLowerCase() !== wallet
      || reviewed.data.chainId !== intent.chain_id || reviewed.data.asset !== plan.source_asset_id
      || reviewed.data.amountRaw !== plan.from_amount_raw || reviewed.data.destinationChainId !== plan.destination_chain_id
      || reviewed.data.destinationAssetId !== plan.destination_asset_id
      || reviewed.data.toAmountMinRaw !== plan.to_amount_min_raw)
      return reply({ error: "review_mismatch", traceId }, 409);
    const [from, to] = await Promise.all([resolveCatalogAsset(plan.source_asset_id), resolveCatalogAsset(plan.destination_asset_id)]);
    if (!from || !to) return reply({ error: "route_unavailable", traceId }, 422);
    let governed;
    try { governed = await assertSwapPrepareIntegrity(plan, { from, to }, now.getTime()); }
    catch { return reply({ error: "route_unavailable", traceId }, 422); }
    if (reviewed.data.amount !== formatUnits(BigInt(plan.from_amount_raw), from.decimals))
      return reply({ error: "review_mismatch", traceId }, 409);
    const chain = SUPPORTED_CHAINS.find(({ id }) => id === 8453);
    if (!chain) return reply({ error: "route_unavailable", traceId }, 422);
    const client = createPublicClient({ transport: http(chain.rpcUrls.default.http[0]) });
    const valuation = await valueSwapSource({ assetId: plan.source_asset_id, amountRaw: plan.from_amount_raw }, { now });
    if (valuation.decimals !== from.decimals || valuation.rawUnits !== plan.from_amount_raw)
      return reply({ error: "review_mismatch", traceId }, 409);
    const balance = await observeSwapSourceBalance(client, { wallet, assetId: plan.source_asset_id,
      amountRaw: plan.from_amount_raw, nowMs: now.getTime(), maxAgeMs: 120_000 });
    const approval = await observeNextSwapApproval(client, { plan: {
      fromAssetId: plan.source_asset_id, fromChainId: 8453, fromAmountRaw: plan.from_amount_raw,
      approvalSpender: plan.approval_spender, sourceCall: governed.sourceCall
    }, wallet, reviewedSpender: governed.reviewedSpender, nowMs: now.getTime(), maxAgeMs: 120_000 });
    if (approval.kind !== "sufficient") return reply({ error: "approval_required", traceId }, 409);
    const call = await normalizePreparedCall(governed.sourceCall);
    try { await observeSwapExecutionBudget(client, { call, plan: { sourceCall: governed.sourceCall,
      fromChainId: 8453, fromAssetId: plan.source_asset_id, fromAmountRaw: plan.from_amount_raw },
      sourceBalance: balance, nowMs: now.getTime(), maxAgeMs: 120_000 }); }
    catch { return reply({ error: "simulation_unavailable", traceId }, 503); }

    const rollingStart = new Date(now.getTime() - 86_400_000).toISOString();
    const [profile, spending] = await Promise.all([
      env.PROJECTION_DB.prepare(`SELECT account_locked, enforce_address_book, daily_limit_usd,
        new_address_threshold_usd, step_up_threshold_usd, new_address_delay_seconds
        FROM security_profiles WHERE subject_reference = ?`).bind(subject.subjectReference).first<Profile>(),
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
        .bind(subject.subjectReference, input.intentId, rollingStart, rollingStart, now.toISOString())
        .first<{ spent_cents: number; missing: number }>()
    ]);
    if (!profile || profile.account_locked) return reply({ error: "account_locked", traceId }, 403);
    const spentCents = spending?.spent_cents ?? 0;
    const valuedCents = Number(valuation.usdCents);
    const limitCents = Math.floor(Math.min(profile.daily_limit_usd, beta.transactionLimitUsd) * 100);
    if (Boolean(spending?.missing) || !Number.isSafeInteger(spentCents) || spentCents < 0
      || !Number.isSafeInteger(valuedCents) || valuedCents <= 0
      || !Number.isSafeInteger(limitCents) || limitCents < 0)
      return reply({ error: "spent_value_unavailable", traceId }, 403);
    const decision = evaluateTransactionPolicy({ type: "swap", chainId: 8453, asset: plan.source_asset_id,
      amount: reviewed.data.amount, destination: wallet }, { supportedChainIds: [8453],
      allowlistedDestinations: [], coolingDestinations: [], enforceAllowlist: Boolean(profile.enforce_address_book),
      accountLocked: false, reserveFloorUsd: 10_000,
      dailyLimitUsd: Math.min(profile.daily_limit_usd, beta.transactionLimitUsd), spentTodayUsd: spentCents / 100,
      newAddressThresholdUsd: profile.new_address_threshold_usd,
      stepUpThresholdUsd: profile.step_up_threshold_usd, delayThresholdUsd: 25_000,
      delaySeconds: profile.new_address_delay_seconds }, now, valuation.usdCents);
    if (!decision.permitted || decision.releaseAt) return reply({ error: "policy_not_permitted", traceId }, 403);
    if (decision.requiresStepUp) return reply({ error: "step_up_unavailable", traceId }, 403);
    // RPC and pricing checks can outlive a 45-second quote. Never insert or
    // return a signable call against the time captured before those awaits.
    const at = new Date().toISOString();
    if (intent.expires_at <= at || plan.expires_at <= at) return reply({ error: "quote_expired", traceId }, 409);
    const [insert] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`INSERT INTO intent_prepared_calls
        (intent_id, step_index, subject_reference, wallet_address, chain_id, target_address, native_value,
         calldata_hash, call_fingerprint, semantic_action, source_reference, expires_at, expected_effect_json,
         verification_state, created_at, submission_phase)
        SELECT i.intent_id, 0, i.subject_reference, ?, 8453, ?, ?, ?, ?, 'swap',
          'swap-plan:' || p.plan_id, i.expires_at, ?, 'prepared', ?, 'released'
        FROM transaction_intents i JOIN swap_quote_plans p ON p.intent_id = i.intent_id
        JOIN security_profiles s ON s.subject_reference = i.subject_reference AND s.account_locked = 0
        JOIN beta_access b ON b.subject_reference = i.subject_reference AND b.status = 'active'
          AND b.country_code = ?
        JOIN feature_flags f ON f.flag_key = 'swaps' AND f.enabled = 1 AND f.audience IN ('all', 'beta')
        WHERE i.intent_id = ? AND i.subject_reference = ? AND i.intent_type = 'swap'
          AND i.chain_id = 8453 AND i.wallet_reference = ? AND i.route_reference = 'swap-plan:' || p.plan_id
          AND i.status = 'reviewed' AND i.expires_at > ?
          AND i.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          AND p.plan_id = ? AND p.status = 'active'
          AND p.expires_at > ? AND p.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          AND p.wallet_address = ? AND p.source_chain_id = 8453
          AND p.destination_chain_id = 8453 AND p.fingerprint = ? AND p.route_policy_version = ?
          AND NOT EXISTS (SELECT 1 FROM intent_prepared_calls prior WHERE prior.intent_id = i.intent_id)
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
            CAST(MIN(s.daily_limit_usd, b.transaction_limit_usd) * 100 AS INTEGER))`)
        .bind(wallet, call.to.toLowerCase(), call.value, call.dataHash, call.fingerprint,
          JSON.stringify({ type: "swap", ...governed.expectedEffect }), at, beta.countryCode,
          input.intentId, subject.subjectReference, `wallet:${wallet}`, at, input.planId, at,
          wallet, plan.fingerprint, plan.route_policy_version,
          subject.subjectReference, input.intentId, rollingStart, rollingStart, at, valuedCents),
      env.PROJECTION_DB.prepare(`INSERT INTO intent_events (event_id, intent_id, subject_reference,
        event_type, evidence_json, occurred_at)
        SELECT ?, ?, ?, 'call_prepared', ?, ? WHERE changes() = 1`)
        .bind(crypto.randomUUID(), input.intentId, subject.subjectReference,
          JSON.stringify({ stepIndex: 0, fingerprint: call.fingerprint, semanticAction: "swap" }), at),
      env.PROJECTION_DB.prepare(`INSERT INTO intent_valuations
        (valuation_id, intent_id, asset_id, raw_units, decimals, price_usd, market_price_usd, price_source,
         price_observed_at, valued_at, usd_cents, policy_version, depeg_uncertainty)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
        .bind(crypto.randomUUID(), input.intentId, valuation.assetId, valuation.rawUnits, valuation.decimals,
          valuation.priceUsd, valuation.marketPriceUsd, valuation.priceSource, valuation.priceObservedAt,
          valuation.valuedAt, valuation.usdCents, valuation.policyVersion, Number(valuation.depegUncertainty))
    ]);
    if (insert.meta.changes !== 1) return reply({ error: "prepare_conflict", traceId }, 409);
    return reply({ intentId: input.intentId, stepIndex: 0, fingerprint: call.fingerprint,
      call: { chainId: call.chainId, from: call.from, to: call.to, value: call.value, data: call.data },
      expiresAt: intent.expires_at, traceId }, 201);
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized", traceId }, 401);
    if (error instanceof BetaAccessError) return reply({ error: error.code, traceId }, 403);
    if (error instanceof WalletOwnershipError) return reply({ error: "wallet_not_linked", traceId }, 403);
    if (error instanceof FeatureUnavailableError) return reply({ error: "feature_unavailable", traceId }, 503);
    if (error instanceof RateLimitError) return reply({ error: "rate_limited", traceId }, 429);
    if (error instanceof ValuationError) return reply({ error: "valuation_unavailable", traceId }, 503);
    if (error instanceof z.ZodError) return reply({ error: "invalid_preparation", traceId }, 400);
    console.error(JSON.stringify({ level: "error", event: "swap.prepare_failed", traceId,
      message: error instanceof Error ? error.message : "unknown" }));
    return reply({ error: "prepare_unavailable", traceId }, 503);
  }
}
