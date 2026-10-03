import { env } from "cloudflare:workers";
import { requireFeature } from "@/lib/features/flags";
import { route } from "@/lib/http/route";
import { listPerpMarkets } from "@/lib/markets/perps";

/** Hyperliquid's perp markets and prices, read now. Public, like the venue's own list. */
export const GET = route("perps.markets", { unavailable: "markets_unavailable" }, async (_request, { traceId }) => {
  await requireFeature(env.PROJECTION_DB, "perps");
  return Response.json({ markets: await listPerpMarkets(), traceId }, { headers: { "Cache-Control": "public, max-age=5" } });
});
