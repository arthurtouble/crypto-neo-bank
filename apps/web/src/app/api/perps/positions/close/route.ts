import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { closePerpsPosition } from "@/lib/markets/perps";

const schema = z.strictObject({ coin: z.string().min(1).max(60) });

/** Close the customer's whole position in one market at market price. */
export const POST = route("perps.positions.close", { invalid: "invalid_close", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 60);
    const { coin } = schema.parse(await readJsonBody(request));
    const result = await closePerpsPosition(env.PROJECTION_DB, subject, account.address, coin);
    return Response.json({ statuses: result.statuses, traceId });
  });
