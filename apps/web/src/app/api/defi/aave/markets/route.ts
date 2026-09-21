import { getAaveBaseMarkets } from "@/lib/defi/aave";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") ?? undefined;
  if (address && !/^0x[a-fA-F0-9]{40}$/.test(address)) return Response.json({ error: "invalid_address" }, { status: 400 });
  try {
    const market = await getAaveBaseMarkets(address);
    return Response.json(market, { headers: { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=120", "X-Aurel-Data-Authority": "aave-and-base" } });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "aave.markets.failed", message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "market_unavailable", message: "Live Aave market data is temporarily unavailable." }, { status: 503 });
  }
}

