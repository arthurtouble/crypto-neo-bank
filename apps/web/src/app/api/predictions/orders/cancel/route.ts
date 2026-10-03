import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { cancelPredictionOrder } from "@/lib/markets/predictions";

const schema = z.strictObject({ orderId: z.string().regex(/^0x[\da-fA-F]{1,128}$/) });

/** Cancel one of the customer's resting Polymarket orders. */
export const POST = route("predictions.cancel", { invalid: "invalid_cancel", unavailable: "predictions_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "predictions", 60);
    const { orderId } = schema.parse(await readJsonBody(request));
    return Response.json({ ...await cancelPredictionOrder(env.PROJECTION_DB, subject, account.address, orderId), traceId });
  });
