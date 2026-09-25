import { env } from "cloudflare:workers";
import { createPublicClient, formatUnits, http, isAddress } from "viem";
import { z } from "zod";
import { SUPPORTED_CHAINS } from "@/config/supported-chains";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { requireFeature } from "@/lib/features/flags";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { resolveCatalogAsset } from "@/lib/swap/catalog";
import { isDirectUniswapPlan, DIRECT_SWAP_ROUTER } from "@/lib/swap/direct-uniswap";
import { assertSwapPrepareIntegrity } from "@/lib/swap/prepare-integrity";
import { getActiveSwapQuotePlan, bindSwapQuotePlan } from "@/lib/swap/plans";
import { observeSwapSourceBalance } from "@/lib/swap/source-balance";
import { evaluateTransactionPolicy } from "@/lib/transactions/policy";
import { ValuationError, valueSwapSource } from "@/lib/transactions/valuation";
import { route, errorResponse } from "@/lib/http/route";

const inputSchema = z.object({ planId: z.string().uuid(), walletAddress: z.string().refine(isAddress) }).strict();
const callSchema = z.object({ chainId: z.number().int(), from: z.string().refine(isAddress),
  to: z.string().refine(isAddress), value: z.string().regex(/^\d+$/), data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
  providerGasLimit: z.string().regex(/^\d+$/).optional(), providerGasPrice: z.string().regex(/^\d+$/).optional() }).strict();

function reply(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const POST = route("swap.review", { unavailable: "review_unavailable", invalid: "invalid_review", onError: (error, context) => error instanceof ValuationError ? errorResponse(503, "valuation_unavailable", context) : undefined }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_review", subject: subject.subjectReference, limit: 20, windowSeconds: 600 });
  const input = inputSchema.parse(await request.json());
  const wallet = await requireLinkedEvmWallet(subject.subjectReference, input.walletAddress);
  await requireFeature(env.PROJECTION_DB, "swaps");
  const now = new Date();
  const plan = await getActiveSwapQuotePlan(env.PROJECTION_DB, input.planId, subject.subjectReference, wallet, now.getTime());
  if (!plan || plan.intent_id) return reply({ error: "quote_expired", traceId }, 409);
  if (plan.source_chain_id !== plan.destination_chain_id) await requireFeature(env.PROJECTION_DB, "cross_chain");
  const [from, to] = await Promise.all([resolveCatalogAsset(plan.source_asset_id), resolveCatalogAsset(plan.destination_asset_id)]);
  if (!from || !to || from.eligibility !== "eligible" || to.eligibility !== "eligible"
    || from.verification !== "verified" || to.verification !== "verified") return reply({ error: "asset_unavailable", traceId }, 422);
  const sourceChain = SUPPORTED_CHAINS.find((chain) => chain.id === plan.source_chain_id);
  if (!sourceChain || from.chainId !== plan.source_chain_id || to.chainId !== plan.destination_chain_id
    || plan.recipient.toLowerCase() !== wallet || !/^[1-9]\d*$/.test(plan.from_amount_raw)
    || !/^[1-9]\d*$/.test(plan.to_amount_min_raw)) return reply({ error: "quote_mismatch", traceId }, 409);
  const call = callSchema.safeParse(JSON.parse(plan.source_call_json));
  const targets = new Set<string>((process.env.AUREL_SWAP_ALLOWED_TARGETS ?? "").split(",")
    .map((value) => value.trim().toLowerCase()).filter((value) => isAddress(value)));
  if (!call.success || call.data.chainId !== plan.source_chain_id || call.data.from.toLowerCase() !== wallet
    || !(targets.has(call.data.to.toLowerCase())
      || isDirectUniswapPlan(plan) && call.data.to.toLowerCase() === DIRECT_SWAP_ROUTER.toLowerCase())
    || (from.address === null ? BigInt(call.data.value) !== BigInt(plan.from_amount_raw) : call.data.value !== "0")) {
    return reply({ error: "quote_mismatch", traceId }, 409);
  }
  try { await assertSwapPrepareIntegrity(plan, { from, to }, now.getTime()); }
  catch { return reply({ error: "quote_mismatch", traceId }, 409); }
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference, now);
  const valuation = await valueSwapSource({ assetId: plan.source_asset_id, amountRaw: plan.from_amount_raw }, { now });
  if (valuation.decimals !== from.decimals || valuation.rawUnits !== plan.from_amount_raw) return reply({ error: "quote_mismatch", traceId }, 409);
  // The balance helper verifies the RPC's actual chain ID independently.
  const client = createPublicClient({ transport: http(sourceChain.rpcUrls.default.http[0]) });
  await observeSwapSourceBalance(client, { wallet, assetId: plan.source_asset_id,
    amountRaw: plan.from_amount_raw, nowMs: now.getTime(), maxAgeMs: 120_000 });
  const [profile, spending] = await Promise.all([
    env.PROJECTION_DB.prepare("SELECT account_locked, enforce_address_book, daily_limit_usd, new_address_threshold_usd, step_up_threshold_usd, new_address_delay_seconds FROM security_profiles WHERE subject_reference = ?")
      .bind(subject.subjectReference).first<{ account_locked: number; enforce_address_book: number; daily_limit_usd: number; new_address_threshold_usd: number; step_up_threshold_usd: number; new_address_delay_seconds: number }>(),
    env.PROJECTION_DB.prepare(`SELECT COALESCE(SUM(CAST(v.usd_cents AS INTEGER)), 0) AS spent_cents,
      SUM(CASE WHEN v.valuation_id IS NULL THEN 1 ELSE 0 END) AS missing
      FROM transaction_intents i LEFT JOIN intent_valuations v ON v.rowid =
        (SELECT MAX(v2.rowid) FROM intent_valuations v2 WHERE v2.intent_id = i.intent_id)
      WHERE i.subject_reference = ? AND i.status IN ('submitted', 'confirmed') AND i.created_at >= ?`)
      .bind(subject.subjectReference, new Date(now.getTime() - 86_400_000).toISOString())
      .first<{ spent_cents: number; missing: number }>()
  ]);
  if (!profile || profile.account_locked) return reply({ error: "account_locked", traceId }, 403);
  const spentCents = spending?.spent_cents ?? 0;
  if (Boolean(spending?.missing) || !Number.isSafeInteger(spentCents) || spentCents < 0) return reply({ error: "spent_value_unavailable", traceId }, 403);
  const type: "swap" | "bridge" = plan.source_chain_id === plan.destination_chain_id ? "swap" : "bridge";
  const reviewed = { type, walletAddress: wallet, chainId: plan.source_chain_id,
    asset: plan.source_asset_id, amount: formatUnits(BigInt(plan.from_amount_raw), from.decimals),
    amountRaw: plan.from_amount_raw, destination: plan.recipient, destinationChainId: plan.destination_chain_id,
    destinationAssetId: plan.destination_asset_id, toAmountMinRaw: plan.to_amount_min_raw,
    planId: plan.plan_id, disclosureVersion: "swap-risk-2026-09" };
  const decision = evaluateTransactionPolicy(reviewed, {
    supportedChainIds: SUPPORTED_CHAINS.map((chain) => chain.id), allowlistedDestinations: [], coolingDestinations: [],
    enforceAllowlist: Boolean(profile.enforce_address_book), accountLocked: Boolean(profile.account_locked),
    reserveFloorUsd: 10_000, dailyLimitUsd: profile.daily_limit_usd,
    spentTodayUsd: spentCents / 100, newAddressThresholdUsd: profile.new_address_threshold_usd,
    stepUpThresholdUsd: profile.step_up_threshold_usd, delayThresholdUsd: 25_000,
    delaySeconds: profile.new_address_delay_seconds
  }, now, valuation.usdCents);
  if (!decision.permitted) return reply({ error: "policy_not_permitted", findings: decision.findings.filter((item) => item.level === "block"), traceId }, 403);
  if (decision.releaseAt) return reply({ error: "review_period_required", traceId }, 423);
  // A browser MFA state is not attestation for this exact plan. Never let a
  // high-value plan become reviewed until server-verifiable step-up exists.
  if (decision.requiresStepUp) return reply({ error: "step_up_unavailable", traceId }, 403);
  const intentId = crypto.randomUUID();
  const walletReference = `wallet:${wallet}`;
  const expiresAt = new Date(Math.min(Date.parse(plan.expires_at), now.getTime() + 15 * 60_000)).toISOString();
  const at = now.toISOString();
  await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare(`INSERT INTO wallet_references
      (wallet_reference, subject_reference, provider, provider_wallet_reference, address, chain_family, control_model, observed_at)
      VALUES (?, ?, 'privy', NULL, ?, 'evm', 'user-controlled', ?)
      ON CONFLICT(subject_reference, address) DO UPDATE SET observed_at = excluded.observed_at`)
      .bind(walletReference, subject.subjectReference, wallet, at),
    env.PROJECTION_DB.prepare(`INSERT INTO transaction_intents
      (intent_id, subject_reference, wallet_reference, intent_type, chain_id, request_json, policy_result_json,
        disclosure_version, status, created_at, updated_at, expires_at, route_reference)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reviewed', ?, ?, ?, ?)`)
      .bind(intentId, subject.subjectReference, walletReference, type, plan.source_chain_id,
        JSON.stringify(reviewed), JSON.stringify(decision), reviewed.disclosureVersion, at, at, expiresAt, `swap-plan:${plan.plan_id}`),
    env.PROJECTION_DB.prepare(`INSERT INTO intent_valuations
      (valuation_id, intent_id, asset_id, raw_units, decimals, price_usd, market_price_usd, price_source,
        price_observed_at, valued_at, usd_cents, policy_version, depeg_uncertainty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), intentId, valuation.assetId, valuation.rawUnits, valuation.decimals,
        valuation.priceUsd, valuation.marketPriceUsd, valuation.priceSource, valuation.priceObservedAt,
        valuation.valuedAt, valuation.usdCents, valuation.policyVersion, Number(valuation.depegUncertainty)),
    env.PROJECTION_DB.prepare(`INSERT INTO intent_events
      (event_id, intent_id, subject_reference, event_type, evidence_json, occurred_at)
      VALUES (?, ?, ?, 'policy_evaluated', ?, ?)`)
      .bind(crypto.randomUUID(), intentId, subject.subjectReference, JSON.stringify({ planId: plan.plan_id,
        fingerprint: plan.fingerprint, permitted: true, findings: decision.findings.map((item) => item.code) }), at)
  ]);
  // This guarded one-time link is deliberately separate from any signing
  // authorization. A conflict leaves an inert review record, never a call.
  if (!await bindSwapQuotePlan(env.PROJECTION_DB, { planId: plan.plan_id, intentId,
    subject: subject.subjectReference, wallet, now: Date.now() })) {
    await env.PROJECTION_DB.prepare("UPDATE transaction_intents SET status = 'blocked', updated_at = ? WHERE intent_id = ? AND status = 'reviewed'")
      .bind(new Date().toISOString(), intentId).run();
    return reply({ error: "quote_conflict", traceId }, 409);
  }
  return reply({ intentId, decision, expiresAt, traceId }, 201);
});
