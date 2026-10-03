import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { startPredictionBuy } from "@/lib/markets/predictions";

const schema = z.strictObject({ marketId: z.string().regex(/^\d{1,20}$/), outcome: z.union([z.literal(0), z.literal(1)]),
  amountUsd: z.number().min(1).max(1_000_000) });

/** Price a buy of an outcome in dollars and return it for the customer's passkey. */
export const POST = route("predictions.buy", { invalid: "invalid_order", unavailable: "predictions_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "predictions", 60);
    return Response.json({ ...await startPredictionBuy(env.PROJECTION_DB, subject, account, schema.parse(await readJsonBody(request))), traceId });
  });
