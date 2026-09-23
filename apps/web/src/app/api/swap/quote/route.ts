import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, requireFeature } from "@/lib/features/flags";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { resolveCatalogAsset } from "@/lib/swap/catalog";
import { buildDirectUniswapPlan, isDirectUniswapPair } from "@/lib/swap/direct-uniswap";
import { getSwapQuotePlans } from "@/lib/swap/lifi";
import { saveSwapQuotePlan } from "@/lib/swap/plans";
import { requireExactUnverifiedAcknowledgements, SwapQuoteError, swapQuoteRequestSchema } from "@/lib/swap/quotes";

function reply(body: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await requireFeature(env.PROJECTION_DB, "swaps");
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_quote", subject: subject.subjectReference, limit: 20, windowSeconds: 600 });
    const input = swapQuoteRequestSchema.parse(await request.json());
    const fromAddress = await requireLinkedEvmWallet(subject.subjectReference, input.fromAddress);
    const [from, to] = await Promise.all([resolveCatalogAsset(input.fromAssetId), resolveCatalogAsset(input.toAssetId)]);
    if (!from || !to || from.eligibility !== "eligible" || to.eligibility !== "eligible") {
      throw new SwapQuoteError("asset_unavailable", "One of these assets is not currently available for quotes.");
    }
    if (from.chainId !== to.chainId) await requireFeature(env.PROJECTION_DB, "cross_chain");
    const normalized = { ...input, fromAddress };
    requireExactUnverifiedAcknowledgements(normalized, { from, to });
    const planned = isDirectUniswapPair(from.id, to.id)
      ? [await buildDirectUniswapPlan(normalized, { from, to })]
      : await getSwapQuotePlans(normalized, { from, to });
    const quotes = await Promise.all(planned.map(async ({ quote, plan }) => ({
      ...quote, planId: await saveSwapQuotePlan(env.PROJECTION_DB, subject.subjectReference, fromAddress, plan)
    })));
    return reply({ quotes, observedAt: new Date().toISOString(), authority: "Quote metadata; not execution authority" });
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized", message: error.message, traceId }, 401);
    if (error instanceof RateLimitError) return reply({ error: "rate_limited", message: error.message, traceId }, 429, { "Retry-After": String(error.retryAfterSeconds) });
    if (error instanceof BetaAccessError) return reply({ error: error.code, message: error.message, traceId }, 403);
    if (error instanceof WalletOwnershipError) return reply({ error: "wallet_not_linked", message: error.message, traceId }, 403);
    if (error instanceof FeatureUnavailableError) return reply({ error: "feature_unavailable", message: error.message, traceId }, 503);
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
