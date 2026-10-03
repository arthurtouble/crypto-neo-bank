import { env } from "cloudflare:workers";
import { requireProviderPlace } from "@/lib/legal/places";
import { route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { startPredictionsSetup } from "@/lib/markets/predictions";

/** The next step of connecting the customer's wallet to Polymarket: wait, sign, or ready. */
export const POST = route("predictions.setup", { unavailable: "predictions_unavailable", onError: venueErrorResponse }, async (request, { traceId }) => {
  const { subject, account } = await marketActor(env.PROJECTION_DB, request, "predictions", 20);
  requireProviderPlace(request, "predictions");
  return Response.json({ ...await startPredictionsSetup(env.PROJECTION_DB, subject, account), traceId });
});
