import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireFeature } from "@/lib/features/flags";
import { route } from "@/lib/http/route";
import { venueErrorResponse } from "@/lib/markets/http";
import { priceHistory } from "@/lib/markets/polymarket";

const schema = z.object({ token: z.string().regex(/^\d{1,78}$/), interval: z.enum(["1h", "6h", "1d", "1w", "1m", "max"]).default("1w") });

/** An outcome's price over time, for the odds chart. */
export const GET = route("predictions.history", { invalid: "invalid_request", unavailable: "markets_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    await requireFeature(env.PROJECTION_DB, "predictions");
    const input = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({ history: await priceHistory(input.token, input.interval), traceId }, { headers: { "Cache-Control": "public, max-age=30" } });
  });
