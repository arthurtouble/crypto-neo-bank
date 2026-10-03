import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { completePredictionsSignature } from "@/lib/markets/predictions";

const schema = z.strictObject({ requestId: z.uuid(), authorization: z.string().min(1).max(4_000) });

/** Finish something the customer approved with their passkey, and send it to Polymarket. */
export const POST = route("predictions.signatures", { invalid: "invalid_signature", unavailable: "predictions_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "predictions", 30);
    const input = schema.parse(await readJsonBody(request));
    return Response.json({ ...await completePredictionsSignature(env.PROJECTION_DB, subject, account, input.requestId, input.authorization), traceId });
  });
