import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireFeature } from "@/lib/features/flags";
import { route } from "@/lib/http/route";
import { venueErrorResponse } from "@/lib/markets/http";
import { perpBook } from "@/lib/markets/perps";

const query = z.object({ coin: z.string().min(1).max(60) });

/** One market's order book and spread, read from Hyperliquid now. Public, like the venue's own book. */
export const GET = route("perps.book", { invalid: "invalid_market", unavailable: "markets_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    await requireFeature(env.PROJECTION_DB, "perps");
    const { coin } = query.parse({ coin: new URL(request.url).searchParams.get("coin") ?? undefined });
    const observed = await perpBook(coin);
    const body = observed.status === "observed" ? { status: observed.status, source: observed.source, observedAt: observed.observedAt, ...observed.data } : observed;
    return Response.json({ ...body, traceId }, { headers: { "Cache-Control": "no-store" } });
  });
