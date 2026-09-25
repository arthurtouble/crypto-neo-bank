import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { featureEnabled } from "@/lib/features/flags";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { resolveCatalogAsset } from "@/lib/swap/catalog";
import { buildDirectUniswapPlan, isDirectUniswapPair } from "@/lib/swap/direct-uniswap";
import { getSwapQuotePlans } from "@/lib/swap/lifi";
import { assertSwapPrepareIntegrity } from "@/lib/swap/prepare-integrity";
import { saveSwapQuotePlan, type StoredSwapQuotePlan } from "@/lib/swap/plans";
import { requireExactUnverifiedAcknowledgements, SwapQuoteError, swapQuoteRequestSchema } from "@/lib/swap/quotes";
import { route, errorResponse } from "@/lib/http/route";

function reply(body: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export const POST = route("swap.quote", { unavailable: "quote_unavailable", invalid: "invalid_swap", unavailableMessage: "No validated quote is currently available.", onError: (error, context) => error instanceof SwapQuoteError ? errorResponse(error.code === "unsupported_chain" ? 400 : error.code === "asset_unavailable" || error.code === "acknowledgement_required" ? 422 : 503, error.code, context, { message: error.message }) : undefined }, async (request: Request) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_quote", subject: subject.subjectReference, limit: 20, windowSeconds: 600 });
  const input = swapQuoteRequestSchema.parse(await request.json());
  const fromAddress = await requireLinkedEvmWallet(subject.subjectReference, input.fromAddress);
  const [from, to] = await Promise.all([resolveCatalogAsset(input.fromAssetId), resolveCatalogAsset(input.toAssetId)]);
  if (!from || !to || from.eligibility !== "eligible" || to.eligibility !== "eligible") {
    throw new SwapQuoteError("asset_unavailable", "One of these assets is not currently available for quotes.");
  }
  const reviewAccessAvailable = await featureEnabled(env.PROJECTION_DB, "swaps")
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
});
