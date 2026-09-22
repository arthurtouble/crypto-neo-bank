import { z } from "zod";
import { getXstocksCatalogPage, XstocksCatalogError } from "@/lib/markets/xstocks";

function json(body: unknown, status = 200, cacheControl = "no-store") {
  return Response.json(body, { status, headers: { "Cache-Control": cacheControl } });
}

function parseQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!['q', 'cursor'].includes(key) || params.getAll(key).length !== 1) throw new Error("Invalid instrument search.");
  }
  const query = params.get("q") ?? "";
  const cursor = params.get("cursor") ?? undefined;
  if (query.length > 120 || (cursor && (cursor.length > 2_000 || !/^[A-Za-z0-9_-]+$/.test(cursor)))) throw new Error("Invalid instrument search.");
  return { query, cursor };
}

export function createInstrumentsHandler(loader: (input: { query: string; cursor?: string }) => Promise<object>) {
  return async function getInstruments(request: Request) {
    const traceId = crypto.randomUUID();
    try {
      const page = await loader(parseQuery(request));
      return json({ ...page, authority: "Public issuer metadata for discovery only; not customer eligibility or execution authority" }, 200, "public, max-age=0, s-maxage=60");
    } catch (error) {
      if (error instanceof XstocksCatalogError) {
        const status = error.code === "invalid_cursor" ? 400 : error.code === "stale_cursor" ? 409 : 503;
        return json({ error: status === 503 ? "instrument_catalog_unavailable" : error.code, traceId }, status);
      }
      if (error instanceof z.ZodError || error instanceof Error && error.message === "Invalid instrument search.") {
        return json({ error: "invalid_search", traceId }, 400);
      }
      console.error(JSON.stringify({ level: "error", event: "markets.instruments.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
      return json({ error: "instrument_catalog_unavailable", traceId }, 503);
    }
  };
}

export const GET = createInstrumentsHandler(getXstocksCatalogPage);
