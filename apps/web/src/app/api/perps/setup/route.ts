import { env } from "cloudflare:workers";
import { route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { startPerpsSetup } from "@/lib/markets/perps";

/** Start connecting the customer's wallet to Hyperliquid: returns the approval for their passkey, or ready. */
export const POST = route("perps.setup", { unavailable: "perps_unavailable", onError: venueErrorResponse }, async (request, { traceId }) => {
  const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 10);
  return Response.json({ ...await startPerpsSetup(env.PROJECTION_DB, subject, account), traceId });
});
