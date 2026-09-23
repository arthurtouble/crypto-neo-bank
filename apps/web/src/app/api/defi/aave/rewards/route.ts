import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, requireFeature } from "@/lib/features/flags";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";

const requestSchema = z.object({ sender: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await requireFeature(env.PROJECTION_DB, "defi_actions");
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "aave_reward_claim", subject: subject.subjectReference, limit: 10, windowSeconds: 60 });
    const input = requestSchema.parse(await request.json());
    await requireLinkedEvmWallet(subject.subjectReference, input.sender);
    // Reward distributors and claim effects are not yet independently governed.
    return Response.json({ error: "execution_unavailable", message: "Reward claims aren't available yet.", traceId }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", message: error.message, traceId }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code, message: error.message, traceId }, { status: 403 });
    if (error instanceof WalletOwnershipError) return Response.json({ error: "wallet_not_linked", message: error.message, traceId }, { status: 403, headers: { "Cache-Control": "no-store" } });
    if (error instanceof FeatureUnavailableError) return Response.json({ error: "feature_unavailable", message: error.message, traceId }, { status: 503 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_reward_claim", message: error.issues[0]?.message, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "aave.reward_claim.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "reward_claim_unavailable", message: error instanceof Error ? error.message : "Aave could not prepare this claim. No transaction was submitted.", traceId }, { status: 422 });
  }
}
