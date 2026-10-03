import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { featureEnabled } from "@/lib/features/flags";
import { route } from "@/lib/http/route";

/**
 * Which ways to add money are open now, for the Deposit page. Card purchases
 * run in Privy's funding flow, so `card_deposits` can only hide the way in;
 * Privy's own funding setting is what stops a purchase.
 */
export const GET = route("deposits.methods", { unavailable: "deposit_methods_unavailable" }, async (request, { traceId }) => {
  await requireVerifiedSubject(request);
  return Response.json({ card: await featureEnabled(env.PROJECTION_DB, "card_deposits"), traceId });
});
