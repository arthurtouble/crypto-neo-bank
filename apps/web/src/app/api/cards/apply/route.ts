import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { applicationLink } from "@/lib/cards/service";
import { errorResponse, route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/** Bridge's page where a verified customer applies for cards, or re-confirms their details. The link is short-lived and never stored. */
export const POST = route("cards.apply", { unavailable: "card_unavailable" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "card_apply", subject: subject.subjectReference, limit: 10, windowSeconds: 3600 });
  const url = await applicationLink(env.PROJECTION_DB, subject.subjectReference);
  if (!url) return errorResponse(409, "verification_required", context, { message: "Verify your identity under Add money first." });
  return Response.json({ url, traceId: context.traceId }, { headers: { "Cache-Control": "no-store" } });
});
