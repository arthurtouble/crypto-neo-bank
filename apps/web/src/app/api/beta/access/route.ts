import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, getBetaAccess, redeemBetaInvite } from "@/lib/beta/access";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

const redeemSchema = z.object({ code: z.string().trim().min(6).max(80), countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/), acceptTerms: z.literal(true) });

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    return Response.json({ access: await getBetaAccess(env.PROJECTION_DB, subject.subjectReference), traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    return Response.json({ error: "beta_access_unavailable", traceId }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "beta_redeem", subject: subject.subjectReference, limit: 8, windowSeconds: 3600 });
    const input = redeemSchema.parse(await request.json());
    const access = await redeemBetaInvite(env.PROJECTION_DB, { subjectReference: subject.subjectReference, code: input.code, countryCode: input.countryCode });
    return Response.json({ access, traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", message: error.message, traceId }, { status: 429 });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code, message: error.message, traceId }, { status: 403 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_invitation", issues: error.issues, traceId }, { status: 400 });
    return Response.json({ error: "beta_access_unavailable", traceId }, { status: 503 });
  }
}

