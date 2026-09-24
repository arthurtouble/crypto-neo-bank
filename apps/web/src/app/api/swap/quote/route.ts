import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { BetaAccessError, configuredCountries, requireBetaAccess } from "@/lib/beta/access";
import { featureEnabled } from "@/lib/features/flags";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { resolveCatalogAsset } from "@/lib/swap/catalog";
import { buildDirectUniswapPlan, isDirectUniswapPair } from "@/lib/swap/direct-uniswap";
import { getSwapQuotePlans } from "@/lib/swap/lifi";
import { assertSwapPrepareIntegrity } from "@/lib/swap/prepare-integrity";
import { saveSwapQuotePlan, type StoredSwapQuotePlan } from "@/lib/swap/plans";
import { requireExactUnverifiedAcknowledgements, SwapQuoteError, swapQuoteRequestSchema } from "@/lib/swap/quotes";

function reply(body: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const beta = await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_quote", subject: subject.subjectReference, limit: 20, windowSeconds: 600 });
    const input = swapQuoteRequestSchema.parse(await request.json());
    const fromAddress = await requireLinkedEvmWallet(subject.subjectReference, input.fromAddress);
    const [from, to] = await Promise.all([resolveCatalogAsset(input.fromAssetId), resolveCatalogAsset(input.toAssetId)]);
    if (!from || !to || from.eligibility !== "eligible" || to.eligibility !== "eligible") {
      throw new SwapQuoteError("asset_unavailable", "One of these assets is not currently available for quotes.");
    }
    const reviewAccessAvailable = beta.mode === "invite" && beta.status === "active" && Boolean(beta.countryCode)
      && configuredCountries().includes(beta.countryCode!)
      && await featureEnabled(env.PROJECTION_DB, "swaps")
      && (from.chainId === to.chainId || await featureEnabled(env.PROJECTION_DB, "cross_chain"));
    const normalized = { ...input, fromAddress };
    requireExactUnverifiedAcknowledgements(normalized, { from, to });
    const planned = isDirectUniswapPair(from.id, to.id)
      ? [await buildDirectUniswapPlan(normalized, { from, to })]
      : await getSwapQuotePlans(normalized, { from, to });
    const quotes = reviewAccessAvailable
      ? await Promise.all(planned.map(async ({ quote, plan }) => {
          const candidate: StoredSwapQuotePlan = {
            plan_id: "", subject_reference: subject.subjectReference, wallet_address: fromAddress,
            source_asset_id: plan.fromAssetId, destination_asset_id: plan.toAssetId,
            source_chain_id: plan.fromChainId, destination_chain_id: plan.toChainId,
            from_amount_raw: plan.fromAmountRaw, recipient: plan.recipient, slippage_bps: plan.slippageBps,
            to_amount_min_raw: plan.toAmountMinRaw, quote_id: plan.quoteId, step_id: plan.stepId,
            tool_id: plan.toolId, approval_spender: plan.approvalSpender,
            route_steps_json: JSON.stringify(plan.routeSteps), source_call_json: JSON.stringify(plan.sourceCall),
            economics_json: JSON.stringify(plan.economics), route_policy_version: plan.routePolicyVersion,
            catalog_version: plan.catalogVersion, observed_at: plan.observedAt, expires_at: plan.expiresAt,
            fingerprint: plan.fingerprint, status: "active", intent_id: null
          };
          try { await assertSwapPrepareIntegrity(candidate, { from, to }, Date.now()); }
          catch { return quote; }
          return { ...quote, planId: await saveSwapQuotePlan(env.PROJECTION_DB, subject.subjectReference, fromAddress, plan) };
        }))
      : planned.map(({ quote }) => quote);
    return reply({ quotes, reviewAccessAvailable, observedAt: new Date().toISOString(), authority: "Quote metadata; not execution authority" });
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized", message: error.message, traceId }, 401);
    if (error instanceof RateLimitError) return reply({ error: "rate_limited", message: error.message, traceId }, 429, { "Retry-After": String(error.retryAfterSeconds) });
    if (error instanceof BetaAccessError) return reply({ error: error.code, message: error.message, traceId }, 403);
    if (error instanceof WalletOwnershipError) return reply({ error: "wallet_not_linked", message: error.message, traceId }, 403);
    if (error instanceof SwapQuoteError) {
      const status = error.code === "unsupported_chain" ? 400
        : error.code === "asset_unavailable" || error.code === "acknowledgement_required" ? 422 : 503;
      return reply({ error: error.code, message: error.message, traceId }, status);
    }
    if (error instanceof z.ZodError) return reply({ error: "invalid_swap", message: error.issues[0]?.message, traceId }, 400);
    console.error(JSON.stringify({ level: "error", event: "swap.quote_failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return reply({ error: "quote_unavailable", message: "No validated quote is currently available.", traceId }, 503);
  }
}
