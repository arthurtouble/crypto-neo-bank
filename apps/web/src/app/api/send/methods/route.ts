import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { featureEnabled } from "@/lib/features/flags";
import { route } from "@/lib/http/route";

/**
 * Whether sending is switched on, and sending to another network, for the Send page. The page says so and hides the
 * networks it can't use before the customer fills anything in; the quote and the action check the switches again.
 */
export const GET = route("send.methods", { unavailable: "send_methods_unavailable" }, async (request, { traceId }) => {
  await requireVerifiedSubject(request);
  const [sending, otherNetworks] = await Promise.all([featureEnabled(env.PROJECTION_DB, "direct_transfers"), featureEnabled(env.PROJECTION_DB, "cross_chain")]);
  return Response.json({ sending, otherNetworks, traceId }, { headers: { "Cache-Control": "no-store" } });
});
