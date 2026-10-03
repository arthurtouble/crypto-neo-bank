import { getAaveBaseMarkets } from "@/lib/defi/aave";
import { route } from "@/lib/http/route";

/** Aave's USDC and WETH markets on Base: rates, deposits, and withdrawable liquidity. Public market data, never per account. */
export const GET = route("defi.aave.markets", { unavailable: "market_unavailable", unavailableMessage: "Live Aave market data is temporarily unavailable." }, async () => {
  const market = await getAaveBaseMarkets();
  return Response.json(market, { headers: { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=120", "X-Aurel-Data-Authority": "aave-and-base" } });
});
