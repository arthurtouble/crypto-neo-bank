import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { RateLimitError, enforceRateLimit } from "@/lib/security/rate-limit";
import { resolvePortfolioAccounts } from "@/lib/portfolio/accounts";
import { BaseChainSource } from "@/lib/portfolio/chain-source";
import { BaseAaveSource } from "@/lib/portfolio/aave-source";
import { ingestOnePage, PortfolioIngestError } from "@/lib/portfolio/ingest";
import type { AccountId, HistoricalEventSource } from "@/lib/portfolio/types";

const bodySchema = z.object({
  accountId: z.string().regex(/^8453:0x[a-f0-9]{40}$/),
  sourceId: z.enum(["blockscout:8453", "aave:v3:8453"]),
  cursor: z.string().min(1).max(24_000).nullable().optional()
});

function reply(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "portfolio-refresh", subject: subject.subjectReference, limit: 20, windowSeconds: 60 });
    const input = bodySchema.parse(await request.json());
    // This is deliberately fresh; a browser address or old wallet_reference
    // row never grants scope to portfolio history.
    const accounts = await resolvePortfolioAccounts(subject.subjectReference);
    if (!accounts.some((item) => item.accountId === input.accountId)) return reply({ error: "account_not_linked", traceId }, 403);
    const key = (env as typeof env & { BLOCKSCOUT_API_KEY?: string }).BLOCKSCOUT_API_KEY;
    if (input.sourceId === "blockscout:8453" && !key) return reply({ error: "source_unconfigured", traceId }, 503);
    const source: HistoricalEventSource = input.sourceId === "blockscout:8453" ? new BaseChainSource({ apiKey: key }) : new BaseAaveSource();
    const result = await ingestOnePage(env.PROJECTION_DB, subject.subjectReference, input.accountId as AccountId, source, input.cursor ?? null);
    return reply({ accountId: input.accountId, sourceId: input.sourceId, ...result, traceId }, 200);
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized", traceId }, 401);
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", traceId }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof z.ZodError) return reply({ error: "invalid_refresh", issues: error.issues, traceId }, 400);
    if (error instanceof PortfolioIngestError) return reply({ error: error.code, message: error.message, traceId }, error.code === "invalid_cursor" || error.code === "conflict" || error.code === "reorg" ? 409 : 503);
    console.error(JSON.stringify({ level: "error", event: "portfolio.refresh.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return reply({ error: "refresh_unavailable", traceId }, 503);
  }
}
