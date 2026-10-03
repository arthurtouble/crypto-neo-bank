import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { startPredictionRedeem } from "@/lib/markets/predictions";

const schema = z.strictObject({ marketId: z.string().regex(/^\d{1,20}$/) });

/** Collect winnings from a resolved market, for the customer's passkey. */
export const POST = route("predictions.redeem", { invalid: "invalid_request", unavailable: "predictions_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "predictions", 10);
    const { marketId } = schema.parse(await readJsonBody(request));
    return Response.json({ ...await startPredictionRedeem(env.PROJECTION_DB, subject, account, marketId), traceId });
  });
