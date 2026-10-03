import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireFeature } from "@/lib/features/flags";
import { route } from "@/lib/http/route";
import { venueErrorResponse } from "@/lib/markets/http";
import { listUpOrDown } from "@/lib/markets/polymarket";

const schema = z.object({ asset: z.string().regex(/^[a-z]{2,10}$/i).optional(), window: z.string().regex(/^\w{1,6}$/).optional(),
  cursor: z.string().max(2_000).optional() });

/** Short crypto "Up or Down" markets that are open now. */
export const GET = route("predictions.up_or_down", { invalid: "invalid_request", unavailable: "markets_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    await requireFeature(env.PROJECTION_DB, "predictions");
    const input = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({ ...await listUpOrDown({ ...input, limit: 20 }), traceId }, { headers: { "Cache-Control": "public, max-age=5" } });
  });
