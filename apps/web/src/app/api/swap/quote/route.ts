import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, requireFeature } from "@/lib/features/flags";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { getSwapQuotes, swapQuoteRequestSchema } from "@/lib/swap/lifi";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await requireFeature(env.PROJECTION_DB, "swaps");
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_quote", subject: subject.subjectReference, limit: 20, windowSeconds: 600 });
    const input = swapQuoteRequestSchema.parse(await request.json());
    const fromAddress = await requireLinkedEvmWallet(subject.subjectReference, input.fromAddress);
    return Response.json(await getSwapQuotes({ ...input, fromAddress }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", message: error.message, traceId }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code, message: error.message, traceId }, { status: 403 });
    if (error instanceof WalletOwnershipError) return Response.json({ error: "wallet_not_linked", message: error.message, traceId }, { status: 403, headers: { "Cache-Control": "no-store" } });
    if (error instanceof FeatureUnavailableError) return Response.json({ error: "feature_unavailable", message: error.message, traceId }, { status: 503 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_swap", message: error.issues[0]?.message, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "swap.quote_failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "swap_quote_unavailable", message: error instanceof Error ? error.message : "No validated quote is currently available.", traceId }, { status: 503 });
  }
}
