import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { resolvePortfolioAccounts } from "@/lib/portfolio/accounts";
import { materializePortfolioDaily, PortfolioMaterializeError } from "@/lib/portfolio/materialize";
import { route, errorResponse } from "@/lib/http/route";

function reply(body: Record<string, unknown>, status: number) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

export const POST = route("portfolio.materialize", { unavailable: "materialize_unavailable", onError: (error, context) => error instanceof PortfolioMaterializeError ? errorResponse(error.code === "conflict" ? 409 : error.code === "invalid_scope" ? 403 : 503, error.code, context, { message: error.message }) : undefined }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "portfolio-materialize", subject: subject.subjectReference, limit: 3, windowSeconds: 60 });
  // The request body is not an account or coverage authority. Scope is read
  // afresh from Privy each run; all historical inputs come from D1.
  const accounts = await resolvePortfolioAccounts(subject.subjectReference);
  const result = await materializePortfolioDaily(env.PROJECTION_DB, subject.subjectReference, accounts.map((item) => item.accountId));
  return reply({ ...result, traceId }, 200);
});
