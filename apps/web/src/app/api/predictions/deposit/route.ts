import { env } from "cloudflare:workers";
import { z } from "zod";
import { prepareBuiltAction } from "@/lib/actions/prepare";
import { requireProviderPlace } from "@/lib/legal/places";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { buildPredictionsDeposit } from "@/lib/markets/predictions";
import { actionView } from "../../actions/view";

const schema = z.strictObject({ amount: z.string().regex(/^\d+(\.\d{1,6})?$/).max(24) });

/** Prepare moving Base USDC into the customer's Polymarket wallet, as an action they sign like any other. */
export const POST = route("predictions.deposit", { invalid: "invalid_amount", unavailable: "predictions_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "predictions", 10);
    requireProviderPlace(request, "predictions");
    const { amount } = schema.parse(await readJsonBody(request));
    const built = await buildPredictionsDeposit(env.PROJECTION_DB, subject, account.address, amount);
    const prepared = await prepareBuiltAction(env.PROJECTION_DB, subject, account.address, built, () => "predictions");
    if (!prepared.ok) return Response.json({ error: prepared.block.code, message: prepared.block.message, traceId }, { status: 409 });
    return Response.json({ action: actionView(prepared.action), traceId }, { status: 201 });
  });
