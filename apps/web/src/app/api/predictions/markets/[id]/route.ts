import { env } from "cloudflare:workers";
import { requireFeature } from "@/lib/features/flags";
import { route } from "@/lib/http/route";
import { venueErrorResponse } from "@/lib/markets/http";
import { clobQuotes, getMarket, marketUpOrDown, withPriceToBeat } from "@/lib/markets/polymarket";

/**
 * One market with live prices for both outcomes, by Gamma id or by slug (Polymarket's positions name markets by slug).
 * For an Up or Down market, `upOrDown` carries its window and the price to beat. Sports markets answer not found.
 */
export const GET = route("predictions.market", { unavailable: "markets_unavailable", onError: venueErrorResponse },
  async (_request, { traceId }, { params }: { params: Promise<{ id: string }> }) => {
    await requireFeature(env.PROJECTION_DB, "predictions");
    const ref = (await params).id;
    const market = await getMarket(/^\d{1,20}$/.test(ref) ? { id: ref } : { slug: ref });
    const [quotes, { upOrDown }] = await Promise.all([
      clobQuotes([market.yesTokenId, market.noTokenId]).catch(() => null),
      withPriceToBeat({ startTime: market.startTime, endDate: market.endDate, resolutionSource: market.resolutionSource, upOrDown: marketUpOrDown(market) })
    ]);
    return Response.json({ market, quotes, upOrDown, observedAt: new Date().toISOString(), traceId }, { headers: { "Cache-Control": "public, max-age=5" } });
  });
