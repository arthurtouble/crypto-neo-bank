import { env } from "cloudflare:workers";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { placePerpsTrade } from "@/lib/markets/perps";
import { perpsTradeSchema } from "@/lib/markets/perps-input";

/** Open or add to a position from a dollar margin, with leverage, margin mode, and optional auto-close. */
export const POST = route("perps.trade", { invalid: "invalid_order", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 60);
    const result = await placePerpsTrade(env.PROJECTION_DB, subject, account.address, perpsTradeSchema.parse(await readJsonBody(request)));
    return Response.json({ ...result, traceId }, { status: 201 });
  });
