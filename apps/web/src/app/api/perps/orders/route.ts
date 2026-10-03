import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { placePerpsOrder } from "@/lib/markets/perps";

const decimal = z.string().regex(/^\d+(\.\d+)?$/).max(40);
const schema = z.strictObject({
  coin: z.string().min(1).max(60), side: z.enum(["buy", "sell"]), size: decimal, type: z.enum(["market", "limit"]),
  limitPrice: decimal.optional(), reduceOnly: z.boolean().optional()
});

/** Place an order on Hyperliquid, signed by the customer's trading key. */
export const POST = route("perps.orders", { invalid: "invalid_order", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 60);
    const result = await placePerpsOrder(env.PROJECTION_DB, subject, account.address, schema.parse(await readJsonBody(request)));
    return Response.json({ statuses: result.statuses, traceId }, { status: 201 });
  });
