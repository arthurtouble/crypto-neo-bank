import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireFeature } from "@/lib/features/flags";
import { route } from "@/lib/http/route";
import { venueErrorResponse } from "@/lib/markets/http";
import { perpCandles } from "@/lib/markets/perps";

const query = z.object({ coin: z.string().min(1).max(60), range: z.enum(["live", "1h", "1d", "1w", "1m", "3m", "1y", "all"]).default("1d") });

/** Price candles for one market's chart, read from Hyperliquid now. Public, like the venue's own charts. */
export const GET = route("perps.candles", { invalid: "invalid_market", unavailable: "markets_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    await requireFeature(env.PROJECTION_DB, "perps");
    const params = new URL(request.url).searchParams;
    const { coin, range } = query.parse({ coin: params.get("coin") ?? undefined, range: params.get("range") ?? undefined });
    const observed = await perpCandles(coin, range);
    const body = observed.status === "observed" ? { status: observed.status, source: observed.source, observedAt: observed.observedAt, ...observed.data } : observed;
    return Response.json({ ...body, traceId }, { headers: { "Cache-Control": range === "live" ? "no-store" : "public, max-age=10" } });
  });
