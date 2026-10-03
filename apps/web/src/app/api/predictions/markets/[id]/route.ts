import { env } from "cloudflare:workers";
import { requireFeature } from "@/lib/features/flags";
import { route } from "@/lib/http/route";
import { venueErrorResponse } from "@/lib/markets/http";
import { clobQuotes, getMarket } from "@/lib/markets/polymarket";

/** One market with live prices for both outcomes. Sports markets answer not found. */
export const GET = route("predictions.market", { unavailable: "markets_unavailable", onError: venueErrorResponse },
  async (_request, { traceId }, { params }: { params: Promise<{ id: string }> }) => {
    await requireFeature(env.PROJECTION_DB, "predictions");
    const market = await getMarket({ id: (await params).id });
    const quotes = await clobQuotes([market.yesTokenId, market.noTokenId]).catch(() => null);
    return Response.json({ market, quotes, observedAt: new Date().toISOString(), traceId }, { headers: { "Cache-Control": "public, max-age=5" } });
  });
