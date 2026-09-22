import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { RateLimitError, enforceRateLimit } from "@/lib/security/rate-limit";
import { resolvePortfolioAccounts } from "@/lib/portfolio/accounts";
import { materializePortfolioDaily, PortfolioMaterializeError } from "@/lib/portfolio/materialize";

function reply(body: Record<string, unknown>, status: number) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "portfolio-materialize", subject: subject.subjectReference, limit: 3, windowSeconds: 60 });
    // The request body is not an account or coverage authority. Scope is read
    // afresh from Privy each run; all historical inputs come from D1.
    const accounts = await resolvePortfolioAccounts(subject.subjectReference);
    const result = await materializePortfolioDaily(env.PROJECTION_DB, subject.subjectReference, accounts.map((item) => item.accountId));
    return reply({ ...result, traceId }, 200);
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized", traceId }, 401);
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", traceId }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof PortfolioMaterializeError) return reply({ error: error.code, message: error.message, traceId }, error.code === "conflict" ? 409 : error.code === "invalid_scope" ? 403 : 503);
    console.error(JSON.stringify({ level: "error", event: "portfolio.materialize.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return reply({ error: "materialize_unavailable", traceId }, 503);
  }
}
