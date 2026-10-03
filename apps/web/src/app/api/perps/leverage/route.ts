import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { setPerpsLeverage } from "@/lib/markets/perps";

const schema = z.strictObject({ coin: z.string().min(1).max(60), isCross: z.boolean(), leverage: z.number().int().min(1).max(1_000) });

/** Build a leverage change for one market, up to the market's own maximum, for the customer's device to sign. */
export const POST = route("perps.leverage", { invalid: "invalid_leverage", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 30);
    const input = schema.parse(await readJsonBody(request));
    return Response.json({ ...await setPerpsLeverage(env.PROJECTION_DB, subject, account.address, input.coin, input.isCross, input.leverage), traceId },
      { status: 202 });
  });
