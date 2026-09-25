import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { resolvePortfolioAccounts } from "@/lib/portfolio/accounts";
import { BaseChainSource } from "@/lib/portfolio/chain-source";
import { BaseAaveSource } from "@/lib/portfolio/aave-source";
import { ingestOnePage, PortfolioIngestError } from "@/lib/portfolio/ingest";
import type { AccountId, HistoricalEventSource } from "@/lib/portfolio/types";
import { route, errorResponse } from "@/lib/http/route";

const bodySchema = z.object({
  accountId: z.string().regex(/^8453:0x[a-f0-9]{40}$/),
  sourceId: z.enum(["blockscout:8453", "aave:v3:8453"]),
  cursor: z.string().min(1).max(24_000).nullable().optional()
});

function reply(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const POST = route("portfolio.refresh", { unavailable: "refresh_unavailable", invalid: "invalid_refresh", onError: (error, context) => error instanceof PortfolioIngestError ? errorResponse(["invalid_cursor", "conflict", "reorg"].includes(error.code) ? 409 : 503, error.code, context, { message: error.message }) : undefined }, async (request: Request, { traceId }) => {
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
});
