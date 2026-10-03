import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { cancelPerpsOrder } from "@/lib/markets/perps";

const schema = z.strictObject({ coin: z.string().min(1).max(60), oid: z.number().int().nonnegative() });

/** Cancel one of the customer's open Hyperliquid orders. */
export const POST = route("perps.orders.cancel", { invalid: "invalid_cancel", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 60);
    const input = schema.parse(await readJsonBody(request));
    const result = await cancelPerpsOrder(env.PROJECTION_DB, subject, account.address, input.coin, input.oid);
    return Response.json({ statuses: result.statuses, traceId });
  });
