import { getMarketHistory, getMarketsPage } from "@/lib/markets/data";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "markets";
  try {
    if (view === "history") {
      const id = url.searchParams.get("id") ?? "ethereum";
      const days = Number(url.searchParams.get("days") ?? "30");
      const history = await getMarketHistory(id, days);
      return Response.json({ history, observedAt: new Date().toISOString(), authority: "Kraken public market data" }, {
        headers: { "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=1800", "X-Aurel-Data-Authority": "kraken" }
      });
    }
    const pageText = url.searchParams.get("page") ?? "1";
    const search = url.searchParams.get("search") ?? "";
    if (!/^[1-9]\d{0,2}$/.test(pageText) || search.length > 80 || [...url.searchParams.keys()].some((key) => key !== "page" && key !== "search" && key !== "view"))
      return Response.json({ error: "invalid_market_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const page = Number(pageText);
    const result = await getMarketsPage(page, 50, search);
    return Response.json({ markets: result.markets, page, total: result.total, observedAt: new Date().toISOString(), authority: "Kraken public market data" }, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300", "X-Aurel-Data-Authority": "kraken" }
    });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "market_data.failed", message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "market_data_unavailable", message: "Live market data is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
