import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { CuratedQuoteError, curatedQuoteInput, getCuratedLifiQuote } from "@/lib/swap/curated-quote";
import { env } from "cloudflare:workers";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const input = curatedQuoteInput.parse(await request.json());
    await requireLinkedEvmWallet(subject.subjectReference, input.walletAddress);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "curated_swap_quote", subject: subject.subjectReference, limit: 30, windowSeconds: 600 });
    return Response.json({ quote: await getCuratedLifiQuote(input) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message }, { status: 401 });
    if (error instanceof WalletOwnershipError) return Response.json({ error: "wallet_not_linked", message: error.message }, { status: 403 });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", message: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_input", message: error.issues[0]?.message }, { status: 400 });
    if (error instanceof CuratedQuoteError) return Response.json({ error: error.code, message: error.message }, { status: error.code === "provider_unavailable" ? 503 : 422 });
    console.error("curated swap quote failed", error);
    return Response.json({ error: "quote_unavailable", message: "Quotes are temporarily unavailable." }, { status: 503 });
  }
}
