import { env } from "cloudflare:workers";
import { createPublicClient, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { previewAaveBaseAction } from "@/lib/defi/aave-preview";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

const schema = z.strictObject({
  action: z.enum(["supply", "withdraw", "borrow", "repay"]),
  sender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  symbol: z.enum(["USDC", "WETH"]),
  amount: z.string().min(1).max(40)
});

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const subject = await requireVerifiedSubject(request);
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "aave_preview", subject: subject.subjectReference, limit: 20, windowSeconds: 60 });
    const input = schema.parse(await request.json());
    await requireLinkedEvmWallet(subject.subjectReference, input.sender);
    const client = createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com", { retryCount: 0, timeout: 12_000 }) }) as PublicClient;
    const preview = await previewAaveBaseAction(client, input);
    return Response.json(preview, { headers });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code }, { status: 403, headers });
    if (error instanceof WalletOwnershipError) return Response.json({ error: "wallet_not_linked" }, { status: 403, headers });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_preview" }, { status: 400, headers });
    console.error(JSON.stringify({ level: "warn", event: "aave.preview.unavailable", message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "preview_unavailable", message: "Current Aave risk could not be confirmed. Try again later." }, { status: 422, headers });
  }
}
