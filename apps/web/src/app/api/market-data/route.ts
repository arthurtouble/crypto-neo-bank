import { getMarketHistory, getMarkets } from "@/lib/markets/data";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "markets";
  try {
    if (view === "history") {
      const id = url.searchParams.get("id") ?? "ethereum";
      const days = Number(url.searchParams.get("days") ?? "30");
      const history = await getMarketHistory(id, days);
      return Response.json({ history, observedAt: new Date().toISOString(), authority: "CoinGecko market data" }, {
        headers: { "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=1800", "X-Aurel-Data-Authority": "coingecko" }
      });
    }
    const page = Math.min(5, Math.max(1, Number(url.searchParams.get("page") ?? "1")));
    const markets = await getMarkets(page);
    return Response.json({ markets, page, observedAt: new Date().toISOString(), authority: "CoinGecko market data" }, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300", "X-Aurel-Data-Authority": "coingecko" }
    });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "market_data.failed", message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "market_data_unavailable", message: "Live market data is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
