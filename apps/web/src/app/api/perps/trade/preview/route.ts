import { env } from "cloudflare:workers";
import { requireActionWallet } from "@/lib/auth/wallet";
import { readJsonBody, route } from "@/lib/http/route";
import { marketReader } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { previewPerpsTrade } from "@/lib/markets/perps";
import { perpsTradeSchema } from "@/lib/markets/perps-input";

/** Size, margin, and estimated liquidation price for a trade, without placing it. */
export const POST = route("perps.trade.preview", { invalid: "invalid_order", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject } = await marketReader(env.PROJECTION_DB, request, "perps");
    const owner = await requireActionWallet(subject);
    const { market, ...preview } = await previewPerpsTrade(owner, perpsTradeSchema.parse(await readJsonBody(request)));
    return Response.json({ ...preview, coin: market.coin, maxLeverage: market.maxLeverage, traceId });
  });
