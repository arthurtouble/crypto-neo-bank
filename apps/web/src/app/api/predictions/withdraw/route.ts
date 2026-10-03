import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { startPredictionsWithdrawal } from "@/lib/markets/predictions";

const schema = z.strictObject({ amount: z.string().regex(/^\d+(\.\d{1,6})?$/).max(24) });

/** A withdrawal from the Polymarket wallet to the account on Base, for the customer's passkey. */
export const POST = route("predictions.withdraw", { invalid: "invalid_withdrawal", unavailable: "predictions_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "predictions", 10);
    const { amount } = schema.parse(await readJsonBody(request));
    return Response.json({ ...await startPredictionsWithdrawal(env.PROJECTION_DB, subject, account, amount), traceId });
  });
