import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireProviderPlace } from "@/lib/legal/places";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { placePerpsOrder } from "@/lib/markets/perps";

const decimal = z.string().regex(/^\d+(\.\d+)?$/).max(40);
const schema = z.strictObject({
  coin: z.string().min(1).max(60), side: z.enum(["buy", "sell"]), size: decimal, type: z.enum(["market", "limit"]),
  limitPrice: decimal.optional(), reduceOnly: z.boolean().optional()
});

/** Build an order for the customer's device to sign; `/api/perps/relay` sends it to Hyperliquid. */
export const POST = route("perps.orders", { invalid: "invalid_order", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 60);
    const input = schema.parse(await readJsonBody(request));
    // Closing is always allowed; opening or adding is refused where Hyperliquid doesn't serve.
    if (!input.reduceOnly) requireProviderPlace(request, "perps");
    return Response.json({ ...await placePerpsOrder(env.PROJECTION_DB, subject, account.address, input), traceId }, { status: 202 });
  });
