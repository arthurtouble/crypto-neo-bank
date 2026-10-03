import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireFeature } from "@/lib/features/flags";
import { route } from "@/lib/http/route";
import { venueErrorResponse } from "@/lib/markets/http";
import { listUpOrDown, withPriceToBeat } from "@/lib/markets/polymarket";

const schema = z.object({ asset: z.string().regex(/^[a-z]{2,10}$/i).optional(), window: z.string().regex(/^\w{1,6}$/).optional(),
  cursor: z.string().max(2_000).optional() });

/** Short crypto "Up or Down" markets that are open now, with the price each has to beat. */
export const GET = route("predictions.up_or_down", { invalid: "invalid_request", unavailable: "markets_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    await requireFeature(env.PROJECTION_DB, "predictions");
    const input = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const page = await listUpOrDown({ ...input, limit: 20 });
    // Gamma has the price to beat only once a window resolves; read it for the windows that are running.
    const events = await Promise.all(page.events.map((event) => withPriceToBeat(event)));
    return Response.json({ ...page, events, traceId }, { headers: { "Cache-Control": "public, max-age=5" } });
  });
