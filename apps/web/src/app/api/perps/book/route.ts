import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireFeature } from "@/lib/features/flags";
import { route } from "@/lib/http/route";
import { venueErrorResponse } from "@/lib/markets/http";
import { perpBook } from "@/lib/markets/perps";

const query = z.object({
  coin: z.string().min(1).max(60),
  // Grouping, as Hyperliquid offers it: significant figures (2 to 5), and at 5 a step of 2 or 5 in the last figure.
  sig: z.coerce.number().int().min(2).max(5).optional(),
  mantissa: z.coerce.number().pipe(z.union([z.literal(2), z.literal(5)])).optional()
}).refine((input) => !input.mantissa || input.sig === 5, { message: "A step needs 5 significant figures.", path: ["mantissa"] });

/** One market's order book and spread, read from Hyperliquid now. Public, like the venue's own book. */
export const GET = route("perps.book", { invalid: "invalid_market", unavailable: "markets_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    await requireFeature(env.PROJECTION_DB, "perps");
    const params = new URL(request.url).searchParams;
    const { coin, sig, mantissa } = query.parse({ coin: params.get("coin") ?? undefined, sig: params.get("sig") ?? undefined, mantissa: params.get("mantissa") ?? undefined });
    const observed = await perpBook(coin, sig ? { grouping: { sigFigs: sig as 2 | 3 | 4 | 5, mantissa: mantissa } } : {});
    const body = observed.status === "observed" ? { status: observed.status, source: observed.source, observedAt: observed.observedAt, ...observed.data } : observed;
    return Response.json({ ...body, traceId }, { headers: { "Cache-Control": "no-store" } });
  });
