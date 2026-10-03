import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireFeature } from "@/lib/features/flags";
import { route } from "@/lib/http/route";
import { venueErrorResponse } from "@/lib/markets/http";
import { listEvents } from "@/lib/markets/polymarket";

const schema = z.object({
  category: z.string().regex(/^[a-z\d-]{1,60}$/i).optional(), search: z.string().max(100).optional(),
  sort: z.enum(["volume", "ending_soon"]).optional(), cursor: z.string().max(2_000).optional()
});

/** Open Polymarket events, sports left out. Public, like Polymarket's own list. */
export const GET = route("predictions.events", { invalid: "invalid_request", unavailable: "markets_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    await requireFeature(env.PROJECTION_DB, "predictions");
    const input = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({ ...await listEvents({ ...input, limit: 20 }), traceId }, { headers: { "Cache-Control": "public, max-age=15" } });
  });
