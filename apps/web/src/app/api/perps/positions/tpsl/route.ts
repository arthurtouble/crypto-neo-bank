import { env } from "cloudflare:workers";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { setPerpsPositionTpsl } from "@/lib/markets/perps";
import { positionTpslSchema } from "@/lib/markets/perps-input";

/** Build auto-close on a whole open position, for the customer's device to sign. */
export const POST = route("perps.positions.tpsl", { invalid: "invalid_tpsl", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 30);
    const input = positionTpslSchema.parse(await readJsonBody(request));
    return Response.json({ ...await setPerpsPositionTpsl(env.PROJECTION_DB, subject, account.address, input), traceId }, { status: 202 });
  });
